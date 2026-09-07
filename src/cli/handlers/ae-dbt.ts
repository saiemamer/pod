import type { CommandHandler, HandlerContext } from '../dispatch'
import { printResult } from '../format'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../flags'
import type {
  DbtCompileResult,
  DbtContextSummary,
  DbtLineageResult,
  DbtListModelsResult,
  DbtModelInfo,
  DbtParseResult,
  DbtShowResult
} from '../../shared/ae/dbt-types'
import {
  formatDbtCompile,
  formatDbtLineage,
  formatDbtListModels,
  formatDbtModelInfo,
  formatDbtParse,
  formatDbtProject,
  formatDbtShow
} from '../ae-dbt-format'

/** Every dbt call names the caller's cwd; the main process finds the project from there. */
function baseParams(ctx: HandlerContext): Record<string, unknown> {
  return {
    path: ctx.cwd,
    projectDir: getOptionalStringFlag(ctx.flags, 'project'),
    target: getOptionalStringFlag(ctx.flags, 'target')
  }
}

function refreshFlag(ctx: HandlerContext): boolean {
  return ctx.flags.get('refresh') === true
}

export const DBT_HANDLERS: Record<string, CommandHandler> = {
  'dbt project': async (ctx) => {
    const result = await ctx.client.call<DbtContextSummary>('dbt.project', baseParams(ctx))
    printResult(result, ctx.json, formatDbtProject)
  },
  'dbt list-models': async (ctx) => {
    const result = await ctx.client.call<DbtListModelsResult>('dbt.listModels', {
      ...baseParams(ctx),
      filter: getOptionalStringFlag(ctx.flags, 'filter'),
      refresh: refreshFlag(ctx)
    })
    printResult(result, ctx.json, formatDbtListModels)
  },
  'dbt model-info': async (ctx) => {
    const result = await ctx.client.call<DbtModelInfo>('dbt.modelInfo', {
      ...baseParams(ctx),
      model: getRequiredStringFlag(ctx.flags, 'model'),
      refresh: refreshFlag(ctx)
    })
    printResult(result, ctx.json, formatDbtModelInfo)
  },
  'dbt lineage': async (ctx) => {
    const result = await ctx.client.call<DbtLineageResult>('dbt.lineage', {
      ...baseParams(ctx),
      model: getRequiredStringFlag(ctx.flags, 'model'),
      depth: getOptionalPositiveIntegerFlag(ctx.flags, 'depth'),
      refresh: refreshFlag(ctx)
    })
    printResult(result, ctx.json, formatDbtLineage)
  },
  'dbt show': async (ctx) => {
    const result = await ctx.client.call<DbtShowResult>('dbt.show', {
      ...baseParams(ctx),
      model: getOptionalStringFlag(ctx.flags, 'model'),
      sql: getOptionalStringFlag(ctx.flags, 'sql'),
      limit: getOptionalPositiveIntegerFlag(ctx.flags, 'limit')
    })
    printResult(result, ctx.json, formatDbtShow)
  },
  'dbt compile': async (ctx) => {
    const result = await ctx.client.call<DbtCompileResult>('dbt.compile', {
      ...baseParams(ctx),
      model: getOptionalStringFlag(ctx.flags, 'model'),
      sql: getOptionalStringFlag(ctx.flags, 'sql')
    })
    printResult(result, ctx.json, formatDbtCompile)
  },
  'dbt parse': async (ctx) => {
    const result = await ctx.client.call<DbtParseResult>('dbt.parse', baseParams(ctx))
    printResult(result, ctx.json, formatDbtParse)
  }
}
