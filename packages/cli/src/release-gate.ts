import type { ReleaseGateStageConfig, WebToolkitCliConfig } from './config.js'
import { buildPackageManagerCommand, runCommandInherited } from './process.js'

type Runtime = {
  cwd: string
  config: WebToolkitCliConfig
}

function resolveStageCommand(config: WebToolkitCliConfig, stage: ReleaseGateStageConfig) {
  if (stage.command) {
    return { command: stage.command, args: stage.args ?? [] }
  }

  if (stage.package && stage.script) {
    return buildPackageManagerCommand(config.packageManager, ['--filter', stage.package, 'run', stage.script, ...(stage.files ?? [])])
  }

  if (stage.package && stage.files?.length) {
    return buildPackageManagerCommand(config.packageManager, ['--filter', stage.package, 'exec', 'vitest', 'run', ...stage.files])
  }

  throw new Error(`Release gate stage "${stage.name}" must define command/args or package/files.`)
}

export function runReleaseGate(runtime: Runtime, requestedStages: string[]): void {
  const stages = runtime.config.releaseGate?.stages
  if (!stages?.length) {
    throw new Error('releaseGate.stages is not configured.')
  }

  const selectedStages = requestedStages.length === 0
    ? stages
    : stages.filter((stage) => requestedStages.includes(stage.name))

  if (requestedStages.length > 0 && selectedStages.length !== requestedStages.length) {
    const knownStages = new Set(stages.map((stage) => stage.name))
    const unknownStages = requestedStages.filter((stageName) => !knownStages.has(stageName))
    throw new Error(`[release-gate] unknown stage(s): ${unknownStages.join(', ')}`)
  }

  for (const stage of selectedStages) {
    console.info(`\n[release-gate] running ${stage.name}`)
    const command = resolveStageCommand(runtime.config, stage)
    const code = runCommandInherited(command, runtime.cwd)
    if (code !== 0) process.exit(code)
  }

  console.info('\n[release-gate] all critical stages passed')
}
