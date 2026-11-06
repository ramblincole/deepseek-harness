import { isAbsolute } from 'node:path'
import z from '@deepseek-ai/schemastery'
import type { ForgeRepository } from '@deepseek-ai/dsh-experimental-forge'

/** One code host the bot serves, with the credentials and webhook source that belong to it. */
export interface ForgeAccess {
  /** Host name as it appears in remote URLs, such as `github.com` or `git.example.com`. */
  host: string
  /** Forge family served by this host. */
  kind: 'github' | 'gitlab'
  /** Credential reference containing the bot account token, used for cloning and for writing reviews. */
  tokenEnv: string
  /** `source` of the webhook adapter row that delivers this host's events. */
  webhookSource: string
}

export const ForgeAccess: z<ForgeAccess> = z.object({
  host: z.string().min(1).required(),
  kind: z.union([z.const('github'), z.const('gitlab')]).default('github'),
  tokenEnv: z.string().role('credential-ref').required(),
  webhookSource: z.string().min(1).required(),
})

/** Explicit model route for review Sessions. */
export interface ReviewModel {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Optional positive output-token cap. */
  maxTokens?: number
}

export const ReviewModel: z<ReviewModel> = z.object({
  provider: z.string().min(1).required(),
  model: z.string().min(1).required(),
  maxTokens: z.number().step(1).min(1),
})

/** Limits and model shared by every project unless the project overrides them. */
export interface ReviewDefaults {
  /** Model for review Sessions; omit to use the deployment's current default model. */
  model?: ReviewModel
  /** Most files one round reviews; the rest are listed as skipped in the summary. */
  maxFiles: number
  /** Most diff bytes one round reviews. */
  maxDiffBytes: number
  /** Most new findings one `submit_review` call may carry. */
  maxFindingsPerRound: number
}

export const ReviewDefaults: z<ReviewDefaults> = z.object({
  model: ReviewModel,
  maxFiles: z.number().step(1).min(1).max(5_000).default(60),
  maxDiffBytes: z.number().step(1).min(1_000).max(50_000_000).default(400_000),
  maxFindingsPerRound: z.number().step(1).min(1).max(500).default(30),
})

/** One onboarded project. */
export interface ProjectConfig {
  /** Repository identity `<forge>:<host>/<owner>/<name>`, such as `gitlab:git.example.com/group/service-a`. */
  repo: string
  /** Target-branch globs that trigger a review, such as `main` or `release/*`. */
  protectedBranches: string[]
  /** Path globs excluded from review, such as `dist/**` or `*.lock`. */
  ignorePaths: string[]
  /** Prompt file name under `promptDir`. */
  promptFile: string
  /** Model override for this project. */
  model?: ReviewModel
  /** Overrides `defaults.maxFiles`. */
  maxFiles?: number
  /** Overrides `defaults.maxDiffBytes`. */
  maxDiffBytes?: number
  /** Overrides `defaults.maxFindingsPerRound`. */
  maxFindingsPerRound?: number
}

export const ProjectConfig: z<ProjectConfig> = z.object({
  repo: z.string().min(1).required(),
  protectedBranches: z.array(z.string().min(1)).required(),
  ignorePaths: z.array(z.string().min(1)).default([]),
  promptFile: z.string().min(1).required(),
  model: ReviewModel,
  maxFiles: z.number().step(1).min(1).max(5_000),
  maxDiffBytes: z.number().step(1).min(1_000).max(50_000_000),
  maxFindingsPerRound: z.number().step(1).min(1).max(500),
})

/** Review bot configuration. */
export interface Config {
  /** Absolute directory holding clones and PR worktrees. */
  reviewRoot: string
  /** Absolute directory holding project prompt files. */
  promptDir: string
  /** Seconds to wait after a push before a round starts; pushes inside the window merge. */
  debounceSeconds: number
  /** Most review rounds running at once across all projects. */
  maxConcurrentReviews: number
  /** Consecutive failed rounds after which a PR is not retried until its next push. */
  maxConsecutiveFailures: number
  /** Seconds one round may run before it is abandoned as failed. */
  roundTimeoutSeconds: number
  /** Extra reminders when the Agent ends a turn without calling `submit_review`. */
  maxSubmitRetries: number
  /** Characters returned by one `review_diff` page. */
  reviewDiffPageChars: number
  /** Seconds one git command may run, except clone. */
  gitTimeoutSeconds: number
  /** Seconds the first clone of a project may run. */
  cloneTimeoutSeconds: number
  /** Code hosts served by the bot. */
  forges: ForgeAccess[]
  /** Limits and model shared by all projects. */
  defaults: ReviewDefaults
  /** Onboarded projects. */
  projects: ProjectConfig[]
}

export const Config: z<Config> = z.object({
  reviewRoot: z.string().min(1).required(),
  promptDir: z.string().min(1).required(),
  debounceSeconds: z.number().step(1).min(0).max(3_600).default(30),
  maxConcurrentReviews: z.number().step(1).min(1).max(16).default(2),
  maxConsecutiveFailures: z.number().step(1).min(1).max(20).default(3),
  roundTimeoutSeconds: z.number().step(1).min(30).max(7_200).default(900),
  maxSubmitRetries: z.number().step(1).min(0).max(5).default(2),
  reviewDiffPageChars: z.number().step(1).min(1_000).max(500_000).default(60_000),
  gitTimeoutSeconds: z.number().step(1).min(5).max(3_600).default(120),
  cloneTimeoutSeconds: z.number().step(1).min(30).max(7_200).default(900),
  forges: z.array(ForgeAccess).required(),
  defaults: ReviewDefaults,
  projects: z.array(ProjectConfig).default([]),
})

/** Repository identity string for a project config: `<forge>:<host>/<owner>/<name>`, lowercase. */
export function repoKey(repository: ForgeRepository): string {
  return `${repository.forge}:${repository.host}/${repository.owner}/${repository.name}`.toLowerCase()
}

/**
 * Find the project config for a repository.
 * @param config - validated bot config.
 * @param repository - repository named by a webhook event.
 * @returns the project, or undefined when the repository is not onboarded.
 */
export function matchProject(config: Config, repository: ForgeRepository): ProjectConfig | undefined {
  const key = repoKey(repository)
  return config.projects.find(project => project.repo.toLowerCase() === key)
}

/** Convert a `*`/`**` glob into an anchored regular expression. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const body = escaped.replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')
  return new RegExp(`^${body}$`)
}

/**
 * Whether a branch name matches any protected-branch glob.
 * @param patterns - globs such as `main` or `release/*`; `*` stays inside one path segment, `**` crosses segments.
 * @param ref - target branch name without `refs/heads/`.
 * @returns true when a pattern matches.
 */
export function isProtectedBranch(patterns: readonly string[], ref: string): boolean {
  return patterns.some(pattern => globToRegExp(pattern).test(ref))
}

/**
 * Check cross-field facts the schema cannot express; the plugin calls this before mounting.
 * @param config - schema-validated bot config.
 * @throws when a path is not absolute, a host or project repeats, or a project names an unlisted host.
 */
export function assertConfig(config: Config): void {
  if (!isAbsolute(config.reviewRoot)) throw new Error('review-bot: reviewRoot must be an absolute path')
  if (!isAbsolute(config.promptDir)) throw new Error('review-bot: promptDir must be an absolute path')
  const hosts = new Set<string>()
  for (const forge of config.forges) {
    if (hosts.has(forge.host)) throw new Error(`review-bot: forges lists host "${forge.host}" twice`)
    hosts.add(forge.host)
  }
  const seen = new Set<string>()
  for (const project of config.projects) {
    const match = /^(github|gitlab):([^/\s]+)\/([^/\s]+)\/(\S+)$/.exec(project.repo)
    if (match === null) throw new Error(`review-bot: project repo "${project.repo}" must look like <forge>:<host>/<owner>/<name>`)
    const key = project.repo.toLowerCase()
    if (seen.has(key)) throw new Error(`review-bot: project "${project.repo}" is configured twice`)
    seen.add(key)
    const host = match[2]
    if (host === undefined) throw new Error(`review-bot: project repo "${project.repo}" has no forge host`)
    if (!hosts.has(host)) throw new Error(`review-bot: project "${project.repo}" uses host "${host}" that forges does not list`)
    if (project.protectedBranches.length === 0) throw new Error(`review-bot: project "${project.repo}" needs at least one protectedBranches pattern`)
  }
}
