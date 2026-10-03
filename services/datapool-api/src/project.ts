import { parseArgs } from 'node:util'
import { Pool } from 'pg'
import { loadProjectionConfig, loadToolConfig } from './config.js'
import { projectionFailed, runAllProjections, runProjectProjection } from './projection.js'

// Projects Field observations into the Data Pool read model.
//   node dist/project.js                    every project, changed sources only
//   node dist/project.js --project <uuid>   one project
//   node dist/project.js --force            reproject even when unchanged
const { values } = parseArgs({
  args: process.argv.slice(2).filter((argument) => argument !== '--'),
  options: {
    project: { type: 'string' },
    force: { type: 'boolean', default: false },
  },
})

const projection = loadProjectionConfig()
const pool = new Pool(loadToolConfig('geoeye-datapool-project').database)
try {
  const options = { force: values.force, includeUnaccepted: projection.includeUnaccepted }
  const results = values.project === undefined
    ? await runAllProjections(pool, options)
    : [await runProjectProjection(pool, values.project, options)]

  if (results.length === 0) process.stdout.write('No projects found; nothing to project.\n')
  for (const result of results) {
    for (const source of result.sources) {
      const issues = Object.entries(source.issueSummary).map(([code, count]) => `${code}=${count}`).join(', ')
      process.stdout.write(
        `${result.projectId} ${source.sourceEntityType}: ${source.outcome}`
        + ` (${source.sourceRowCount} source rows, ${source.observationCount} observations`
        + `${issues === '' ? '' : `; ${issues}`})`
        + `${source.message === null ? '' : ` - ${source.message}`}\n`,
      )
    }
  }
  if (projectionFailed(results)) process.exitCode = 1
} finally {
  await pool.end()
}
