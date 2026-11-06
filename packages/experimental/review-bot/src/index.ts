import type { Context } from '@deepseek-ai/cordis'
import { Config } from './config.ts'

export * from './config.ts'

/** Cordis function-plugin name. */
export const name = 'review-bot'

/** Host services required before the bot can start. */
export const inject = [
  'webhookRuntime', 'forge', 'credentials', 'storageDomain', 'workspaceRegistry', 'agents',
  'agentPresets', 'permissionPresets', 'sessionTitle', 'workingDirectory', 'tools',
]

export { Config }

/** Mount the review bot. */
export function apply(ctx: Context, config: Config): void {
  void ctx
  void config
}
