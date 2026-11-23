import fs from 'fs/promises';
import path from 'path';
import { AgentType, AgentArchetype, SwarmTemplate } from '../types-swarm';
import { getCurrentProjectRoot } from '../current-project-root';

// Resolved on each call so they follow the current project root.
const agentDir = () => path.join(getCurrentProjectRoot(), '.beads', 'archetypes');
const templateDir = () => path.join(getCurrentProjectRoot(), '.beads', 'templates');

export function slugify(name: string): string {
    return name
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

export type SaveAgentTypeInput = Partial<AgentType> & {
    name: string;
    description: string;
    systemPrompt: string;
    capabilities: string[];
    color: string;
};

/** @deprecated Use SaveAgentTypeInput instead */
export type SaveArchetypeInput = SaveAgentTypeInput;

export async function saveAgentType(input: SaveAgentTypeInput): Promise<AgentType> {
    await fs.mkdir(agentDir(), { recursive: true });

    const id = input.id || slugify(input.name);
    const now = new Date().toISOString();

    let isBuiltIn = input.isBuiltIn ?? false;
    let createdAt = input.createdAt || now;

    try {
        const existingContent = await fs.readFile(path.join(agentDir(), `${id}.json`), 'utf-8');
        const existing = JSON.parse(existingContent);
        if (existing.isBuiltIn) {
            isBuiltIn = true; // Protect built-in status
        }
        if (existing.createdAt) {
            createdAt = existing.createdAt;
        }
    } catch {
        // File doesn't exist, which is fine
    }

    const agentType: AgentType = {
        id,
        name: input.name,
        description: input.description,
        systemPrompt: input.systemPrompt,
        capabilities: input.capabilities,
        color: input.color,
        icon: input.icon,
        createdAt,
        updatedAt: now,
        isBuiltIn
    };

    await fs.writeFile(
        path.join(agentDir(), `${id}.json`),
        JSON.stringify(agentType, null, 2)
    );

    return agentType;
}

/** @deprecated Use saveAgentType instead */
export const saveArchetype = saveAgentType;

export async function deleteAgentType(id: string): Promise<void> {
    const filePath = path.join(agentDir(), `${id}.json`);

    let agentType: AgentType;
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        agentType = JSON.parse(content);
    } catch {
        throw new Error(`Agent type not found: ${id}`);
    }

    if (agentType.isBuiltIn) {
        throw new Error(`Cannot delete built-in agent type: ${id}`);
    }

    await fs.unlink(filePath);
}

/** @deprecated Use deleteAgentType instead */
export const deleteArchetype = deleteAgentType;

const SEED_AGENTS: AgentType[] = [
    {
        id: 'architect',
        name: 'System Architect',
        description: 'Designs system structures, decomposes work into actionable tasks, and makes technical decisions.',
        systemPrompt: 'You are a staff-level software architect focused on high-level system design. You create clear, actionable plans that other agents can execute.',
        capabilities: ['system_design', 'work_decomposition', 'technical_decisions', 'risk_assessment', 'documentation'],
        color: '#3b82f6',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isBuiltIn: true
    },
    {
        id: 'engineer',
        name: 'Implementation Engineer',
        description: 'Translates plans into precise, type-safe, and tested code. Focuses on clean implementation and maintainability.',
        systemPrompt: 'You are a senior software engineer focused on turning designs and plans into production-quality code. You implement features, fix bugs, and write tests.',
        capabilities: ['coding', 'refactoring', 'testing', 'debugging', 'documentation'],
        color: '#10b981',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isBuiltIn: true
    },
    {
        id: 'reviewer',
        name: 'Code Reviewer',
        description: 'Conducts rigorous technical code reviews with focus on correctness, performance, maintainability, and test quality.',
        systemPrompt: 'You are a senior systems engineer conducting rigorous technical code reviews. Your analysis prioritizes technical correctness, performance, maintainability, and simplicity. Be direct about problems and constructive with solutions. You do NOT modify files.',
        capabilities: ['code_review', 'quality_gates', 'test_evaluation', 'security_review', 'performance_analysis'],
        color: '#f59e0b',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isBuiltIn: true
    },
    {
        id: 'tester',
        name: 'Test Engineer',
        description: 'Designs and implements comprehensive test suites, discovers edge cases, and ensures code correctness through rigorous verification.',
        systemPrompt: 'You are a senior test engineer focused on ensuring code correctness through comprehensive test design and implementation. You think adversarially about code, always looking for ways it could fail.',
        capabilities: ['test_design', 'test_implementation', 'edge_case_discovery', 'coverage_analysis', 'quality_assurance'],
        color: '#8b5cf6',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isBuiltIn: true
    },
    {
        id: 'investigator',
        name: 'Investigator',
        description: 'Debugs complex issues, performs root cause analysis, and researches unknowns to unblock development.',
        systemPrompt: 'You are a senior engineer specializing in debugging, root cause analysis, and technical research. You excel at unraveling complex problems. You do NOT modify files unless implementing a confirmed fix.',
        capabilities: ['debugging', 'root_cause_analysis', 'research', 'documentation', 'problem_solving'],
        color: '#ef4444',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isBuiltIn: true
    },
    {
        id: 'shipper',
        name: 'Shipper',
        description: 'Manages CI/CD pipelines, deployments, and release processes. Ensures safe and reliable software delivery.',
        systemPrompt: 'You are a senior DevOps/release engineer focused on safe, reliable software delivery. You manage CI/CD pipelines, deployment processes, and release coordination.',
        capabilities: ['ci_cd', 'deployment', 'release_management', 'monitoring', 'incident_response'],
        color: '#06b6d4',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isBuiltIn: true
    }
];

/** @deprecated Use SEED_AGENTS instead */
const SEED_ARCHETYPES = SEED_AGENTS;

export async function getAgentTypes(projectRoot: string = getCurrentProjectRoot()): Promise<AgentType[]> {
    const agentDir = path.join(projectRoot, '.beads', 'archetypes');
    try {
        await fs.mkdir(agentDir, { recursive: true });
        const files = await fs.readdir(agentDir);

        if (files.filter(f => f.endsWith('.json')).length === 0) {
            // Seed defaults
            for (const agent of SEED_AGENTS) {
                await fs.writeFile(path.join(agentDir, `${agent.id}.json`), JSON.stringify(agent, null, 2));
            }
            return SEED_AGENTS;
        }

        const agentTypes: AgentType[] = [];
        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            try {
                const content = await fs.readFile(path.join(agentDir, file), 'utf-8');
                const parsed = JSON.parse(content);
                agentTypes.push({
                    ...parsed,
                    id: file.replace('.json', '')
                });
            } catch (err) {
                console.error(`Failed to parse agent type file: ${file}`, err);
            }
        }

        return agentTypes;
    } catch (e) {
        console.error('Error in getAgentTypes:', e);
        return [];
    }
}

/** @deprecated Use getAgentTypes instead */
export const getArchetypes = getAgentTypes;

const SEED_TEMPLATES: SwarmTemplate[] = [
    {
        id: 'standard-app',
        name: 'Standard Application',
        description: 'Classic balanced team for routine application development. One Architect for design, two Engineers for implementation.',
        team: [{ agentTypeId: 'architect', count: 1 }, { agentTypeId: 'engineer', count: 2 }],
        color: '#f59e0b', icon: '📦',
        createdAt: '2026-02-21T03:22:04.089Z', updatedAt: '2026-02-25T00:00:00.000Z', isBuiltIn: true
    },
    {
        id: 'feature-dev',
        name: 'Feature Development',
        description: 'Balanced team for implementing new features. Architect plans, Engineers build, Reviewer ensures quality, Tester verifies behavior.',
        team: [{ agentTypeId: 'architect', count: 1 }, { agentTypeId: 'engineer', count: 2 }, { agentTypeId: 'reviewer', count: 1 }, { agentTypeId: 'tester', count: 1 }],
        color: '#3b82f6', icon: '✨',
        createdAt: '2026-02-25T00:00:00.000Z', updatedAt: '2026-02-25T00:00:00.000Z', isBuiltIn: true
    },
    {
        id: 'bug-fix',
        name: 'Bug Fix Squad',
        description: 'Focused team for debugging and fixing issues. Investigator finds root cause, Engineer implements fix, Tester verifies resolution.',
        team: [{ agentTypeId: 'investigator', count: 1 }, { agentTypeId: 'engineer', count: 1 }, { agentTypeId: 'tester', count: 1 }],
        color: '#ef4444', icon: '🐛',
        createdAt: '2026-02-25T00:00:00.000Z', updatedAt: '2026-02-25T00:00:00.000Z', isBuiltIn: true
    },
    {
        id: 'code-review',
        name: 'Code Review',
        description: 'Lightweight team for reviewing and improving existing code. Reviewer analyzes, Engineer makes improvements.',
        team: [{ agentTypeId: 'reviewer', count: 1 }, { agentTypeId: 'engineer', count: 1 }],
        color: '#f59e0b', icon: '👁️',
        createdAt: '2026-02-25T00:00:00.000Z', updatedAt: '2026-02-25T00:00:00.000Z', isBuiltIn: true
    },
    {
        id: 'greenfield',
        name: 'Greenfield Project',
        description: 'Full team for starting new projects from scratch.',
        team: [{ agentTypeId: 'architect', count: 1 }, { agentTypeId: 'engineer', count: 3 }, { agentTypeId: 'tester', count: 1 }, { agentTypeId: 'shipper', count: 1 }],
        color: '#10b981', icon: '🌱',
        createdAt: '2026-02-25T00:00:00.000Z', updatedAt: '2026-02-25T00:00:00.000Z', isBuiltIn: true
    },
    {
        id: 'investigation',
        name: 'Investigation Team',
        description: 'Specialized team for research and analysis.',
        team: [{ agentTypeId: 'investigator', count: 1 }, { agentTypeId: 'tester', count: 1 }],
        color: '#8b5cf6', icon: '🔍',
        createdAt: '2026-02-25T00:00:00.000Z', updatedAt: '2026-02-25T00:00:00.000Z', isBuiltIn: true
    },
    {
        id: 'refactor',
        name: 'Refactoring Team',
        description: 'Team for improving existing code without changing behavior.',
        team: [{ agentTypeId: 'architect', count: 1 }, { agentTypeId: 'engineer', count: 2 }, { agentTypeId: 'tester', count: 1 }],
        color: '#64748b', icon: '🔧',
        createdAt: '2026-02-25T00:00:00.000Z', updatedAt: '2026-02-25T00:00:00.000Z', isBuiltIn: true
    },
    {
        id: 'release',
        name: 'Release Team',
        description: 'Team focused on safe deployments.',
        team: [{ agentTypeId: 'tester', count: 1 }, { agentTypeId: 'reviewer', count: 1 }, { agentTypeId: 'shipper', count: 1 }],
        color: '#06b6d4', icon: '🚀',
        createdAt: '2026-02-25T00:00:00.000Z', updatedAt: '2026-02-25T00:00:00.000Z', isBuiltIn: true
    },
    {
        id: 'full-squad',
        name: 'Full Development Squad',
        description: 'Complete team for complex projects requiring all capabilities.',
        team: [{ agentTypeId: 'architect', count: 1 }, { agentTypeId: 'engineer', count: 2 }, { agentTypeId: 'reviewer', count: 1 }, { agentTypeId: 'tester', count: 1 }, { agentTypeId: 'investigator', count: 1 }, { agentTypeId: 'shipper', count: 1 }],
        color: '#ec4899', icon: '🎯',
        createdAt: '2026-02-25T00:00:00.000Z', updatedAt: '2026-02-25T00:00:00.000Z', isBuiltIn: true
    }
];

export async function getTemplates(projectRoot: string = getCurrentProjectRoot()): Promise<SwarmTemplate[]> {
    const templateDir = path.join(projectRoot, '.beads', 'templates');
    try {
        await fs.mkdir(templateDir, { recursive: true });
        const files = await fs.readdir(templateDir);

        if (files.filter(f => f.endsWith('.json')).length === 0) {
            for (const tpl of SEED_TEMPLATES) {
                await fs.writeFile(path.join(templateDir, `${tpl.id}.json`), JSON.stringify(tpl, null, 2));
            }
            return SEED_TEMPLATES;
        }

        const templates: SwarmTemplate[] = [];
        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            try {
                const content = await fs.readFile(path.join(templateDir, file), 'utf-8');
                const parsed = JSON.parse(content);
                
                // Normalize legacy archetypeId → agentTypeId
                if (parsed.team && Array.isArray(parsed.team)) {
                    parsed.team = parsed.team.map((member: any) => ({
                        agentTypeId: member.agentTypeId || member.archetypeId,
                        count: member.count,
                    }));
                }
                
                templates.push({
                    ...parsed,
                    id: file.replace('.json', '')
                });
            } catch (err) {
                console.error(`Failed to parse template file: ${file}`, err);
            }
        }

        return templates;
    } catch (e) {
        console.error('Error in getTemplates:', e);
        return [];
    }
}

export type SaveTemplateInput = {
    id?: string;
    name: string;
    description: string;
    /** Team composition. Accepts both agentTypeId and archetypeId (for backward compat) */
    team: { agentTypeId?: string; archetypeId?: string; count: number }[];
    protoFormula?: string;
    color?: string;
    icon?: string;
    isBuiltIn?: boolean;
    createdAt?: string;
    updatedAt?: string;
};

export async function saveTemplate(input: SaveTemplateInput): Promise<SwarmTemplate> {
    await fs.mkdir(templateDir(), { recursive: true });

    const agentTypes = await getAgentTypes();
    const validAgentTypeIds = new Set(agentTypes.map(a => a.id));

    // Normalize team: support both agentTypeId and archetypeId
    const normalizedTeam = input.team.map(member => ({
        agentTypeId: member.agentTypeId || member.archetypeId || '',
        count: member.count,
    }));

    for (const member of normalizedTeam) {
        if (!validAgentTypeIds.has(member.agentTypeId)) {
            throw new Error(`Invalid agent type ID in team: ${member.agentTypeId}`);
        }
    }

    const id = input.id || slugify(input.name);
    const now = new Date().toISOString();

    let isBuiltIn = input.isBuiltIn ?? false;
    let createdAt = input.createdAt || now;

    try {
        const existingContent = await fs.readFile(path.join(templateDir(), `${id}.json`), 'utf-8');
        const existing = JSON.parse(existingContent);
        if (existing.isBuiltIn) {
            isBuiltIn = true; // Protect built-in status
        }
        if (existing.createdAt) {
            createdAt = existing.createdAt;
        }
    } catch {
        // File doesn't exist, which is fine
    }

    const template: SwarmTemplate = {
        id,
        name: input.name,
        description: input.description,
        team: normalizedTeam,
        protoFormula: input.protoFormula,
        color: input.color,
        icon: input.icon,
        createdAt,
        updatedAt: now,
        isBuiltIn
    };

    await fs.writeFile(
        path.join(templateDir(), `${id}.json`),
        JSON.stringify(template, null, 2)
    );

    return template;
}

export async function deleteTemplate(id: string): Promise<void> {
    const filePath = path.join(templateDir(), `${id}.json`);

    let template: SwarmTemplate;
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        template = JSON.parse(content);
    } catch {
        throw new Error(`Template not found: ${id}`);
    }

    if (template.isBuiltIn) {
        throw new Error(`Cannot delete built-in template: ${id}`);
    }

    await fs.unlink(filePath);
}
