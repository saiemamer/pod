import type { DbtProjectSummary } from '../../../../shared/ae/dbt-types'

/** Pod: whether a file is a dbt model, a .sql file under one of the project's model-paths. */
export function isDbtModelFile(
  filePath: string,
  project: Pick<DbtProjectSummary, 'projectDir' | 'modelPaths'>
): boolean {
  const file = filePath.replace(/\\/g, '/')
  if (!file.toLowerCase().endsWith('.sql')) {
    return false
  }
  const root = project.projectDir.replace(/\\/g, '/').replace(/\/+$/, '')
  return project.modelPaths.some((modelPath) => {
    const dir = modelPath
      .replace(/\\/g, '/')
      .replace(/^\.?\//, '')
      .replace(/\/+$/, '')
    return dir !== '' && file.startsWith(`${root}/${dir}/`)
  })
}
