import { ipcMain } from 'electron'
import type { AeDbtService } from '../../ae/dbt/dbt-service'
import type {
  DbtCompileRequest,
  DbtLineageRequest,
  DbtListModelsRequest,
  DbtModelRequest,
  DbtParseRequest,
  DbtPathRequest,
  DbtShowRequest
} from '../../../shared/ae/dbt-types'

export const AE_DBT_IPC_CHANNELS = [
  'ae:dbt:project',
  'ae:dbt:show',
  'ae:dbt:compile',
  'ae:dbt:parse',
  'ae:dbt:listModels',
  'ae:dbt:modelInfo',
  'ae:dbt:lineage'
] as const

/** Pod: dbt operations for the editor. Errors carry dbt's own message, so the renderer shows it as is. */
export function registerAeDbtHandlers(service: AeDbtService): void {
  for (const channel of AE_DBT_IPC_CHANNELS) {
    ipcMain.removeHandler(channel)
  }
  ipcMain.handle('ae:dbt:project', (_event, args: DbtPathRequest) => service.project(args))
  ipcMain.handle('ae:dbt:show', (_event, args: DbtShowRequest) => service.show(args))
  ipcMain.handle('ae:dbt:compile', (_event, args: DbtCompileRequest) => service.compile(args))
  ipcMain.handle('ae:dbt:parse', (_event, args: DbtParseRequest) => service.parse(args))
  ipcMain.handle('ae:dbt:listModels', (_event, args: DbtListModelsRequest) =>
    service.listModels(args)
  )
  ipcMain.handle('ae:dbt:modelInfo', (_event, args: DbtModelRequest) => service.modelInfo(args))
  ipcMain.handle('ae:dbt:lineage', (_event, args: DbtLineageRequest) => service.lineage(args))
}
