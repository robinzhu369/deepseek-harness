/** Remove inherited general-purpose tools from the dedicated modeling scope. */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'modeling-tool-policy'
export const inject = ['tools']

/** Keep only tools registered inside the modeling preset scope. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.tools.restrict({ allow: [] }))
}
