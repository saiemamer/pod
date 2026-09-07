import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import type { AeDbtService } from '../../ae/dbt/dbt-service'
import { ensureDbtCatalog, exportDbtCsv, resolveDbtRefRequest } from '../../ae/dbt/dbt-artifact-ops'
import type { DbtLspService } from '../../ae/dbt/dbt-lsp-service'
import {
  dbtCatalogTreeRequest,
  dbtColumnLineageRequest,
  dbtGraphRequest,
  dbtLineageEngineRequest,
  type DbtLineageServices
} from '../../ae/dbt/dbt-lineage-ops'
import type { DbtColumnLineageRequest, DbtGraphRequest } from '../../../shared/ae/dbt-graph-types'
import type {
  DbtLspChangeRequest,
  DbtLspDocumentRequest,
  DbtLspOpenRequest,
  DbtLspPositionRequest
} from '../../../shared/ae/dbt-lsp-types'
import type {
  DbtCatalogRequest,
  DbtCompileRequest,
  DbtExportCsvRequest,
  DbtLineageRequest,
  DbtListModelsRequest,
  DbtModelRequest,
  DbtParseRequest,
  DbtPathRequest,
  DbtResolveRefRequest,
  DbtShowRequest
} from '../../../shared/ae/dbt-types'

export const AE_DBT_IPC_CHANNELS = [
  'ae:dbt:project',
  'ae:dbt:show',
  'ae:dbt:compile',
  'ae:dbt:parse',
  'ae:dbt:listModels',
  'ae:dbt:modelInfo',
  'ae:dbt:lineage',
  'ae:dbt:ensureCatalog',
  'ae:dbt:resolveRef',
  'ae:dbt:exportCsv',
  'ae:dbt:graph',
  'ae:dbt:columnLineage',
  'ae:dbt:catalogTree',
  'ae:dbt:lineageEngine',
  'ae:dbt:lsp:status',
  'ae:dbt:lsp:open',
  'ae:dbt:lsp:change',
  'ae:dbt:lsp:close',
  'ae:dbt:lsp:completion',
  'ae:dbt:lsp:hover',
  'ae:dbt:lsp:definition',
  'ae:dbt:lsp:restart'
] as const

/** Renderer-bound push channel for diagnostics and server status. */
export const AE_DBT_LSP_EVENT_CHANNEL = 'ae:dbt:lsp:event'

/** Pod: dbt operations for the editor. Errors carry dbt's own message, so the renderer shows it as is. */
export function registerAeDbtHandlers(
  service: AeDbtService,
  lsp: DbtLspService,
  lineage: DbtLineageServices,
  _mainWindow: BrowserWindow
): void {
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
  ipcMain.handle('ae:dbt:ensureCatalog', (_event, args: DbtCatalogRequest) =>
    ensureDbtCatalog(service, args)
  )
  ipcMain.handle('ae:dbt:resolveRef', (_event, args: DbtResolveRefRequest) =>
    resolveDbtRefRequest(service, args)
  )
  ipcMain.handle('ae:dbt:exportCsv', (_event, args: DbtExportCsvRequest) =>
    exportDbtCsv(service, args)
  )
  ipcMain.handle('ae:dbt:graph', (_event, args: DbtGraphRequest) =>
    dbtGraphRequest(service, lineage, args)
  )
  ipcMain.handle('ae:dbt:columnLineage', (_event, args: DbtColumnLineageRequest) =>
    dbtColumnLineageRequest(service, lineage, args)
  )
  ipcMain.handle('ae:dbt:catalogTree', (_event, args: DbtPathRequest) =>
    dbtCatalogTreeRequest(service, args)
  )
  ipcMain.handle('ae:dbt:lineageEngine', (_event, args: DbtPathRequest) =>
    dbtLineageEngineRequest(service, lineage, args)
  )
  ipcMain.handle('ae:dbt:lsp:status', (_event, args: DbtLspDocumentRequest) => lsp.status(args))
  ipcMain.handle('ae:dbt:lsp:open', (_event, args: DbtLspOpenRequest) => lsp.open(args))
  ipcMain.handle('ae:dbt:lsp:change', (_event, args: DbtLspChangeRequest) => lsp.change(args))
  ipcMain.handle('ae:dbt:lsp:close', (_event, args: DbtLspDocumentRequest) => lsp.close(args))
  ipcMain.handle('ae:dbt:lsp:completion', (_event, args: DbtLspPositionRequest) =>
    lsp.completion(args)
  )
  ipcMain.handle('ae:dbt:lsp:hover', (_event, args: DbtLspPositionRequest) => lsp.hover(args))
  ipcMain.handle('ae:dbt:lsp:definition', (_event, args: DbtLspPositionRequest) =>
    lsp.definition(args)
  )
  ipcMain.handle('ae:dbt:lsp:restart', (_event, args: DbtLspDocumentRequest) => lsp.restart(args))
}
