import type { TaskStepConfig, WebToolkitCliConfig } from './config.js'
import { formatCommand, runCommandBuffered } from './process.js'

type Runtime = {
  cwd: string
  config: WebToolkitCliConfig
}

async function runStepWithStatus(step: TaskStepConfig, runtime: Runtime): Promise<void> {
  if (!step.command) {
    throw new Error(`Validate step "${step.label}" must define command.`)
  }

  const label = 'Running '
  process.stdout.write(`- ${label} \x1b[1m${step.label.padEnd(10)}\x1b[0m... `)
  const startedAt = Date.now()
  const result = await runCommandBuffered({
    command: step.command,
    args: step.args ?? [],
    cwd: step.cwd,
    env: step.env,
  }, runtime.cwd)
  const duration = ((Date.now() - startedAt) / 1000).toFixed(1)

  if (result.code === 0) {
    console.info(`\x1b[32mOK\x1b[0m (${duration}s)`)
    if (result.output.trim()) console.info(result.output.trim())
    return
  }

  console.info(`\x1b[31mFALHA\x1b[0m (${duration}s)`)
  console.info(`\n\x1b[31mDetalhes da falha em\x1b[0m \x1b[1m${step.label}\x1b[0m:`)
  console.info('\x1b[90m' + '-'.repeat(process.stdout.columns || 50) + '\x1b[0m')
  console.info(result.output.trim() || `Command failed: ${formatCommand(step.command, step.args ?? [])}`)
  console.info('\x1b[90m' + '-'.repeat(process.stdout.columns || 50) + '\x1b[0m\n')
  throw new Error(`Validate step "${step.label}" failed.`)
}

export async function runValidateEngine(runtime: Runtime): Promise<void> {
  const validate = runtime.config.validate
  if (!validate?.steps?.length) {
    throw new Error('validate.steps is not configured.')
  }

  console.info('\nIniciando validação do monorepo...\n')
  for (const step of validate.steps) {
    await runStepWithStatus(step, runtime)
  }

  if (validate.postSteps?.length) {
    console.info('\nVerificando pós-validação...\n')
    for (const step of validate.postSteps) {
      await runStepWithStatus(step, runtime)
    }
  }

  console.info('\n\x1b[32m✔ Validação concluida!\x1b[0m\n')
}
