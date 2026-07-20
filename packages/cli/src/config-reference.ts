type JsonSchema = Record<string, unknown>

const stringArray = (description: string): JsonSchema => ({
  type: 'array',
  items: { type: 'string' },
  description,
})

export const configSchema: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'WebToolkit CLI configuration',
  description: 'Reference for .webtoolkit-cli/config.json.',
  type: 'object',
  additionalProperties: false,
  properties: {
    packageManager: {
      type: 'string',
      default: 'pnpm',
      description: 'Package-manager command used by CLI engines.',
      examples: ['pnpm'],
    },
    cleaner: { $ref: '#/$defs/cleaner' },
    tasks: {
      type: 'object',
      description: 'Named task recipes used by build, check, and run:<name>.',
      additionalProperties: { $ref: '#/$defs/task' },
      examples: [{ build: { steps: [{ label: 'TypeScript', command: 'pnpm', args: ['exec', 'tsc', '--noEmit'] }] } }],
    },
    documentation: { $ref: '#/$defs/documentation' },
    workspaceTests: { $ref: '#/$defs/workspaceTests' },
    repoCheck: { $ref: '#/$defs/repoCheck' },
    releaseGate: { $ref: '#/$defs/releaseGate' },
    validate: { $ref: '#/$defs/validate' },
    jsdocReport: { $ref: '#/$defs/jsdocReport' },
    bundleAudit: { $ref: '#/$defs/bundleAudit' },
    upgrade: { $ref: '#/$defs/upgrade' },
    devWatch: { $ref: '#/$defs/devWatch' },
    devGrid: { $ref: '#/$defs/devGrid' },
    environment: { $ref: '#/$defs/environment' },
  },
  $defs: {
    taskStep: {
      type: 'object',
      required: ['label'],
      additionalProperties: false,
      properties: {
        label: { type: 'string', description: 'Human-readable step name.' },
        builtinGuard: { type: 'string', description: 'Builtin guard name; command is unnecessary when set.' },
        command: { type: 'string', description: 'Executable to spawn.' },
        args: stringArray('Command arguments, one shell token per item.'),
        cwd: { type: 'string', description: 'Optional project-relative working directory.' },
        env: { type: 'object', additionalProperties: { type: 'string' }, description: 'Environment variables for the step.' },
        appendArgs: { type: 'boolean', default: false, description: 'Append extra CLI arguments to this step.' },
        outputMode: { enum: ['inherit', 'buffered'], default: 'inherit', description: 'Whether output streams live or only on failure.' },
      },
    },
    task: {
      type: 'object',
      required: ['steps'],
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'Heading printed before the task.' },
        failFast: { type: 'boolean', default: true, description: 'Skip later steps after a failure.' },
        outputMode: { enum: ['inherit', 'buffered'], default: 'inherit' },
        steps: { type: 'array', items: { $ref: '#/$defs/taskStep' } },
      },
    },
    cleanerLevel: {
      type: 'object',
      additionalProperties: false,
      properties: {
        label: { type: 'string' },
        removeEmptyDirs: { type: 'boolean' },
        removableDirNames: stringArray('Artifact directory names removable at repository or workspace roots.'),
        removableFileNames: stringArray('Exact removable file names.'),
        removableFileSuffixes: stringArray('Removable file suffixes.'),
        removableFilePrefixes: stringArray('Removable file prefixes.'),
        removableFilePatterns: stringArray('Regular expressions matched against file names.'),
        removableSpecificFiles: stringArray('Exact project-relative removable files.'),
      },
    },
    cleaner: {
      type: 'object',
      description: 'Cleanup discovery and per-level overrides.',
      additionalProperties: false,
      properties: {
        workspaceRootNames: stringArray('Directories whose direct children are workspace roots.'),
        protectedRootNames: stringArray('Top-level directories protected from empty-directory cleanup.'),
        skipEmptyDirNames: stringArray('Directory names skipped during empty-directory cleanup.'),
        skipArtifactDirNames: stringArray('Directory names skipped while scanning artifacts.'),
        levels: {
          type: 'object',
          additionalProperties: false,
          properties: {
            empty: { $ref: '#/$defs/cleanerLevel' },
            cache: { $ref: '#/$defs/cleanerLevel' },
            deep: { $ref: '#/$defs/cleanerLevel' },
            nuclear: { $ref: '#/$defs/cleanerLevel' },
          },
        },
      },
      examples: [{ workspaceRootNames: ['apps', 'packages'], protectedRootNames: ['apps', 'scripts'] }],
    },
    documentationMetadataRule: {
      type: 'object',
      additionalProperties: false,
      properties: {
        equals: { type: 'string', description: 'Required value; supports {basename} and {stem}.' },
        unique: { type: 'boolean', default: false, description: 'Require a distinct value across the collection.' },
        repositoryPaths: { type: 'boolean', default: false, description: 'Treat inline-code values as repository-relative paths that must exist.' },
        minItems: { type: 'integer', minimum: 0, default: 1, description: 'Minimum inline-code paths when repositoryPaths is enabled.' },
      },
    },
    documentationPairedDocuments: {
      type: 'object',
      required: ['target'],
      additionalProperties: false,
      properties: {
        target: { type: 'string', description: 'Paired-document path template; supports {basename} and {stem}.' },
        index: { type: 'string', description: 'Optional index that must link to each paired document exactly once.' },
        table: {
          type: 'object',
          required: ['header', 'fileColumn'],
          additionalProperties: false,
          properties: {
            header: stringArray('Exact Markdown table header cells.'),
            fileColumn: { type: 'string', description: 'Column containing one or more inline-code repository file paths.' },
            minRows: { type: 'integer', minimum: 0, default: 1 },
          },
        },
        finalSection: {
          type: 'object',
          required: ['heading'],
          additionalProperties: false,
          properties: {
            heading: { type: 'string', description: 'Exact final H2 heading, without ##.' },
            minItems: { type: 'integer', minimum: 0, default: 1, description: 'Minimum list items beneath the section.' },
          },
        },
      },
    },
    documentationCollection: {
      type: 'object',
      required: ['files'],
      additionalProperties: false,
      properties: {
        files: stringArray('Glob patterns selecting collection documents.'),
        exclude: stringArray('Glob patterns excluded from the collection.'),
        index: { type: 'string', description: 'Index that must link to every collection document exactly once.' },
        metadata: {
          type: 'object',
          description: 'Required blockquote metadata fields and their validation rules.',
          additionalProperties: { $ref: '#/$defs/documentationMetadataRule' },
        },
        pairedDocuments: { $ref: '#/$defs/documentationPairedDocuments' },
      },
    },
    documentation: {
      type: 'object',
      description: 'Declarative Markdown, collection, paired-document, and coverage-inventory checks.',
      required: ['files'],
      additionalProperties: false,
      properties: {
        files: stringArray('Glob patterns selecting Markdown files to inspect.'),
        excludeDirectories: stringArray('Directory names excluded from repository scanning.'),
        checks: {
          type: 'object',
          additionalProperties: false,
          properties: {
            singleH1: { type: 'boolean', default: true },
            headingOrder: { type: 'boolean', default: true },
            localLinks: { type: 'boolean', default: true },
            reachability: {
              type: 'object',
              required: ['entrypoints', 'files'],
              additionalProperties: false,
              properties: {
                entrypoints: stringArray('Glob patterns selecting reachability roots.'),
                files: stringArray('Glob patterns selecting documents that must be reachable.'),
              },
            },
          },
        },
        requiredFiles: stringArray('Exact repository-relative files that must exist.'),
        collections: { type: 'array', items: { $ref: '#/$defs/documentationCollection' } },
        inventories: {
          type: 'array',
          items: {
            type: 'object',
            required: ['document', 'sources'],
            additionalProperties: false,
            properties: {
              document: { type: 'string', description: 'Markdown inventory document.' },
              sources: stringArray('Glob or exact path patterns whose matches must be listed as inline code.'),
              minMatches: { type: 'integer', minimum: 0, default: 0 },
            },
          },
        },
      },
      examples: [{
        files: ['docs/**/*.md', '**/README.md'],
        checks: {
          reachability: { entrypoints: ['**/README.md'], files: ['docs/**/*.md'] },
        },
      }],
    },
    workspaceTarget: {
      type: 'object',
      required: ['name', 'package', 'path'],
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        package: { type: 'string' },
        path: { type: 'string' },
      },
    },
    workspaceTests: {
      type: 'object',
      description: 'Workspace targets and failure-report behavior for test commands.',
      required: ['workspaces'],
      additionalProperties: false,
      properties: {
        workspaces: { type: 'array', items: { $ref: '#/$defs/workspaceTarget' } },
        errorLogFile: { type: 'string', default: 'tests_output_errors.log' },
        testFilePattern: { type: 'string', default: '\\.(test|spec)\\.(ts|tsx|js|jsx)$' },
        ignoreDirNames: stringArray('Directory names skipped while counting tests.'),
        maxFailureExcerptLines: { type: 'integer', minimum: 1 },
      },
      examples: [{ workspaces: [{ name: 'Core', package: '@acme/core', path: 'packages/core' }] }],
    },
    repoCheck: {
      type: 'object',
      description: 'Ordered repository-quality checks.',
      required: ['steps'],
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        failFast: { type: 'boolean', default: true },
        steps: { type: 'array', items: { $ref: '#/$defs/taskStep' } },
      },
      examples: [{ steps: [{ label: 'Documentation', builtinGuard: 'documentation' }] }],
    },
    releaseGate: {
      type: 'object',
      description: 'Critical release stages.',
      required: ['stages'],
      additionalProperties: false,
      properties: {
        stages: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name'],
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              command: { type: 'string' },
              args: stringArray('Command arguments.'),
              package: { type: 'string' },
              script: { type: 'string' },
              files: stringArray('Focused Vitest files.'),
            },
          },
        },
      },
    },
    validate: {
      type: 'object',
      description: 'Main and post-validation steps.',
      required: ['steps'],
      additionalProperties: false,
      properties: {
        steps: { type: 'array', items: { $ref: '#/$defs/taskStep' } },
        postSteps: { type: 'array', items: { $ref: '#/$defs/taskStep' } },
      },
    },
    jsdocReport: {
      type: 'object',
      description: 'JSDoc scan paths and report behavior.',
      required: ['includePaths'],
      additionalProperties: false,
      properties: {
        includePaths: stringArray('Project-relative directories scanned by default.'),
        excludePatterns: stringArray('Regular expressions excluded from scanning.'),
        reportFile: { type: 'string' },
        maxLineLength: { type: 'integer', minimum: 1 },
        promptForReport: { type: 'boolean' },
      },
    },
    bundleAudit: {
      type: 'object',
      description: 'Frontend build directories and size thresholds.',
      required: ['appDirs'],
      additionalProperties: false,
      properties: {
        appDirs: stringArray('Frontend app directories containing dist/assets.'),
        top: { type: 'integer', minimum: 1 },
        rawWarningBytes: { type: 'integer', minimum: 0 },
      },
    },
    upgrade: {
      type: 'object',
      description: 'Dependency-upgrade policy.',
      additionalProperties: false,
      properties: {
        defaultCooldownDays: { type: 'integer', minimum: 0 },
        protectedDependencyUpstreamHints: {
          type: 'object',
          additionalProperties: { type: 'array', items: { type: 'string' } },
        },
        protectedOverridesFile: { type: 'string' },
        singletonGuardCommand: { $ref: '#/$defs/taskStep' },
      },
    },
    devApp: {
      type: 'object',
      required: ['displayName', 'port'],
      additionalProperties: false,
      properties: {
        displayName: { type: 'string' },
        port: { type: 'integer', minimum: 1, maximum: 65535 },
        filter: { type: 'string' },
        color: { type: 'string' },
      },
    },
    devWatch: {
      type: 'object',
      description: 'Development app ports and package filters.',
      required: ['apps', 'defaultApps'],
      additionalProperties: false,
      properties: {
        apps: { type: 'object', additionalProperties: { $ref: '#/$defs/devApp' } },
        defaultApps: stringArray('App keys started when --apps is omitted.'),
        backendApp: { type: 'string' },
        host: { type: 'string', default: '127.0.0.1' },
        backendPortCleanupGraceMs: { type: 'integer', minimum: 0 },
      },
    },
    devGridPane: {
      type: 'object',
      required: ['title', 'command'],
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        command: { type: 'string' },
        silentCommand: { type: 'string' },
        fontSize: { type: 'integer', minimum: 1 },
        fullWidth: { type: 'boolean' },
      },
    },
    devGrid: {
      type: 'object',
      description: 'Terminal panes and fallback scripts for development.',
      required: ['panes'],
      additionalProperties: false,
      properties: {
        panes: { type: 'array', items: { $ref: '#/$defs/devGridPane' } },
        maxPanels: { type: 'integer', minimum: 1 },
        fallbackScript: { type: 'string' },
        silentFallbackScript: { type: 'string' },
        preflightCommand: { $ref: '#/$defs/taskStep' },
      },
    },
    environment: {
      type: 'object',
      description: 'Node, package-manager, and Corepack policy.',
      additionalProperties: false,
      properties: {
        requiredNodeMajor: { type: 'integer', minimum: 1 },
        packageManager: { type: 'string' },
        corepackHome: { type: 'string' },
      },
    },
  },
}

function schemaObject(value: unknown): JsonSchema {
  return value as JsonSchema
}

function properties(): Record<string, JsonSchema> {
  return schemaObject(configSchema.properties) as Record<string, JsonSchema>
}

function definitions(): Record<string, JsonSchema> {
  return schemaObject(configSchema.$defs) as Record<string, JsonSchema>
}

function resolveReference(schema: JsonSchema): JsonSchema {
  const reference = schema.$ref
  if (typeof reference !== 'string') return schema
  return definitions()[reference.replace('#/$defs/', '')]
}

export function configSectionNames(): string[] {
  return Object.keys(properties())
}

export function getConfigSchema(section?: string): JsonSchema {
  if (!section) return configSchema
  const selected = properties()[section]
  if (!selected) throw new Error(`Unknown config section "${section}". Available sections: ${configSectionNames().join(', ')}.`)

  return {
    $schema: configSchema.$schema,
    title: `${section} configuration`,
    type: 'object',
    additionalProperties: false,
    properties: { [section]: selected },
    $defs: configSchema.$defs,
  }
}

export function formatConfigHelp(section?: string): string {
  if (!section) {
    const lines = [
      'Usage: webtoolkit config [--help [section] | --json [section]]',
      '',
      'Configuration file: .webtoolkit-cli/config.json',
      '',
      'Sections:',
    ]
    for (const name of configSectionNames()) {
      const description = resolveReference(properties()[name]).description
      lines.push(`  ${name.padEnd(18)} ${String(description)}`.trimEnd())
    }
    lines.push('', 'Use `webtoolkit config --help <section>` for fields and examples.')
    lines.push('Use `webtoolkit config --json [section]` for JSON Schema output.')
    return lines.join('\n')
  }

  const selected = properties()[section]
  if (!selected) throw new Error(`Unknown config section "${section}". Available sections: ${configSectionNames().join(', ')}.`)
  const resolved = resolveReference(selected)
  const required = new Set(Array.isArray(resolved.required) ? resolved.required : [])
  const sectionProperties = schemaObject(resolved.properties ?? {}) as Record<string, JsonSchema>
  const lines = [section, String(resolved.description), '', 'Fields:']

  for (const [name, field] of Object.entries(sectionProperties)) {
    const fieldType = typeof field.type === 'string' ? field.type : 'object'
    const defaultValue = Object.hasOwn(field, 'default') ? `; default=${JSON.stringify(field.default)}` : ''
    lines.push(`  ${name} (${fieldType}; ${required.has(name) ? 'required' : 'optional'}${defaultValue})`)
    if (field.description) lines.push(`    ${String(field.description)}`)
  }

  const examples = Array.isArray(resolved.examples) ? resolved.examples : []
  if (examples.length > 0) {
    lines.push('', 'Example:', JSON.stringify({ [section]: examples[0] }, null, 2))
  }
  lines.push('', `Machine-readable schema: webtoolkit config --json ${section}`)
  return lines.join('\n')
}

export function runConfigReference(args: string[]): void {
  const json = args.includes('--json')
  const unknownFlags = args.filter((arg) => arg.startsWith('-') && !['--json', '--help', '-h'].includes(arg))
  const sections = args.filter((arg) => !arg.startsWith('-'))
  if (unknownFlags.length > 0 || sections.length > 1) {
    throw new Error(`Usage: webtoolkit config [--help [section] | --json [section]]`)
  }

  const section = sections[0]
  console.info(json ? JSON.stringify(getConfigSchema(section), null, 2) : formatConfigHelp(section))
}
