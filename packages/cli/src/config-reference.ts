import path from 'node:path'
import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js'
import { builtinGuards } from './guard-registry.js'

type JsonSchema = Record<string, unknown>

const stringArray = (description: string, options: {
  minItems?: number
  format?: 'project-path' | 'regex'
} = {}): JsonSchema => ({
  type: 'array',
  items: {
    type: 'string',
    minLength: 1,
    ...(options.format ? { format: options.format } : {}),
  },
  ...(options.minItems === undefined ? {} : { minItems: options.minItems }),
  description,
})

const projectPath = (description?: string): JsonSchema => ({
  type: 'string',
  minLength: 1,
  format: 'project-path',
  ...(description ? { description } : {}),
})

const projectPaths = (description: string, minItems = 1): JsonSchema => (
  stringArray(description, { minItems, format: 'project-path' })
)

const regexPatterns = (description: string): JsonSchema => (
  stringArray(description, { format: 'regex' })
)

const builtinGuardNames = Object.keys(builtinGuards).sort()

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
    guards: { $ref: '#/$defs/guards' },
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
      oneOf: [
        {
          required: ['command'],
          properties: {
            command: { type: 'string' },
            builtinGuard: false,
          },
        },
        {
          required: ['builtinGuard'],
          properties: {
            command: false,
            builtinGuard: { type: 'string' },
          },
        },
      ],
      additionalProperties: false,
      properties: {
        label: { type: 'string', minLength: 1, description: 'Human-readable step name.' },
        builtinGuard: {
          type: 'string',
          enum: builtinGuardNames,
          description: 'Builtin guard name; command is unnecessary when set.',
        },
        command: { type: 'string', minLength: 1, description: 'Executable to spawn.' },
        args: stringArray('Command arguments, one shell token per item.'),
        cwd: projectPath('Optional project-relative working directory.'),
        env: { type: 'object', additionalProperties: { type: 'string' }, description: 'Environment variables for the step.' },
        appendArgs: { type: 'boolean', default: false, description: 'Append extra CLI arguments to this step.' },
        outputMode: { type: 'string', enum: ['inherit', 'buffered'], default: 'inherit', description: 'Whether output streams live or only on failure.' },
      },
    },
    commandStep: {
      type: 'object',
      required: ['label', 'command'],
      additionalProperties: false,
      properties: {
        label: { type: 'string', minLength: 1 },
        command: { type: 'string', minLength: 1 },
        args: stringArray('Command arguments, one shell token per item.'),
        cwd: projectPath('Optional project-relative working directory.'),
        env: { type: 'object', additionalProperties: { type: 'string' } },
        appendArgs: { type: 'boolean', default: false },
        outputMode: { type: 'string', enum: ['inherit', 'buffered'], default: 'inherit' },
      },
    },
    task: {
      type: 'object',
      required: ['steps'],
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'Heading printed before the task.' },
        failFast: { type: 'boolean', default: true, description: 'Skip later steps after a failure.' },
        outputMode: { type: 'string', enum: ['inherit', 'buffered'], default: 'inherit' },
        steps: { type: 'array', minItems: 1, items: { $ref: '#/$defs/taskStep' } },
      },
    },
    pathScanGuard: {
      type: 'object',
      required: ['includePaths'],
      additionalProperties: false,
      properties: {
        includePaths: projectPaths('Project-relative directories scanned by the guard.'),
        excludePatterns: regexPatterns('Additional regular expressions excluded after the CLI safe base exclusions.'),
      },
    },
    guards: {
      type: 'object',
      description: 'Consumer-owned policy for configurable builtin guards.',
      additionalProperties: false,
      properties: {
        any: { $ref: '#/$defs/pathScanGuard' },
        internalLink: { $ref: '#/$defs/pathScanGuard' },
        schema: {
          type: 'object',
          required: ['centralDirectory', 'includePaths', 'builders'],
          additionalProperties: false,
          properties: {
            centralDirectory: projectPath('Project-relative directory where schemas may be defined.'),
            includePaths: projectPaths('Project-relative directories scanned by the guard.'),
            builders: stringArray('Zod builder names treated as schema definitions.', { minItems: 1 }),
            excludePatterns: regexPatterns('Additional regular expressions excluded after the CLI safe base exclusions.'),
          },
        },
        rebuildPreflight: {
          type: 'object',
          required: ['targets'],
          additionalProperties: false,
          properties: {
            targets: {
              type: 'object',
              minProperties: 1,
              additionalProperties: {
                type: 'object',
                required: ['warningTitle', 'turboFilters', 'relevantBuildPackages'],
                additionalProperties: false,
                properties: {
                  warningTitle: { type: 'string' },
                  turboFilters: stringArray('Package filters passed to Turbo.', { minItems: 1 }),
                  relevantBuildPackages: stringArray('Build packages whose cache status is relevant.'),
                },
              },
            },
          },
        },
        tsconfig: { $ref: '#/$defs/tsconfigGuard' },
        dalServiceRepository: { $ref: '#/$defs/dalServiceRepositoryGuard' },
        codePattern: { $ref: '#/$defs/codePatternGuard' },
        packageSurface: { $ref: '#/$defs/packageSurfaceGuard' },
        repositoryHygiene: { $ref: '#/$defs/repositoryHygieneGuard' },
        workspaceManifest: { $ref: '#/$defs/workspaceManifestGuard' },
      },
      examples: [{
        any: { includePaths: ['apps', 'packages'] },
        internalLink: { includePaths: ['apps/web/src'] },
        schema: {
          centralDirectory: 'packages/contracts/src/schemas',
          includePaths: ['apps/api/src', 'apps/web/src'],
          builders: ['object', 'enum', 'array', 'nativeEnum'],
        },
        repositoryHygiene: {
          forbiddenPathPatterns: ['(^|/)\\.env($|\\.)', '\\.(pem|key|p12)$'],
          allowedPathPatterns: ['(^|/)\\.env\\.example$'],
        },
        packageSurface: {
          packageDirectories: ['packages/library'],
          forbiddenPublishedPatterns: ['(^|/)__tests__/', '\\.(test|spec)\\.'],
        },
        tsconfig: {
          packageScope: '@acme',
          configs: [{ path: 'tsconfig.json', compilerOptions: { strict: true } }],
        },
        workspaceManifest: {
          packageRoots: ['apps', 'packages'],
          requireWorkspaceProtocol: true,
          peerRequirements: [],
        },
      }],
    },
    repositoryHygieneGuard: {
      type: 'object',
      required: ['forbiddenPathPatterns', 'allowedPathPatterns'],
      additionalProperties: false,
      properties: {
        forbiddenPathPatterns: stringArray(
          'Regular expressions forbidden in normalized Git-tracked project paths.',
          { minItems: 1, format: 'regex' },
        ),
        allowedPathPatterns: regexPatterns(
          'Explicit exceptions checked before forbidden tracked-path patterns.',
        ),
      },
    },
    packageSurfaceGuard: {
      type: 'object',
      required: ['packageDirectories', 'forbiddenPublishedPatterns'],
      additionalProperties: false,
      properties: {
        packageDirectories: projectPaths(
          'Project-relative package directories verified after build.',
        ),
        forbiddenPublishedPatterns: regexPatterns(
          'Regular expressions forbidden in normalized npm package paths.',
        ),
      },
    },
    tsconfigGuard: {
      type: 'object',
      required: ['configs'],
      additionalProperties: false,
      properties: {
        packageScope: { type: 'string', description: 'Scoped package prefix whose aliases must use a slash.' },
        configs: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['path'],
            additionalProperties: false,
            properties: {
              path: projectPath(),
              requiredIncludes: projectPaths('Values required in the tsconfig include array.', 0),
              compilerOptions: {
                type: 'object',
                additionalProperties: {
                  anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
                },
              },
              publicAliases: stringArray('Aliases that must not map directly to src internals.'),
            },
          },
        },
        textFiles: {
          type: 'array',
          items: {
            type: 'object',
            required: ['path', 'forbiddenStrings'],
            additionalProperties: false,
            properties: {
              path: projectPath(),
              forbiddenStrings: stringArray('Literal strings forbidden in the file.', { minItems: 1 }),
            },
          },
        },
      },
    },
    dalServiceRepositoryGuard: {
      type: 'object',
      required: ['sourceDirectory', 'tsconfig', 'layers', 'forbiddenDependencies'],
      additionalProperties: false,
      properties: {
        sourceDirectory: projectPath(),
        tsconfig: projectPath(),
        excludePatterns: regexPatterns('Additional regular expressions excluded after the CLI safe base exclusions.'),
        layers: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['name', 'paths'],
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              paths: projectPaths('Path prefixes relative to sourceDirectory.'),
              exclude: projectPaths('Path prefixes excluded from this layer.', 0),
            },
          },
        },
        forbiddenDependencies: {
          type: 'object',
          minProperties: 1,
          additionalProperties: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    codePatternGuard: {
      type: 'object',
      required: ['tsconfig', 'modelsDirectory', 'rules'],
      additionalProperties: false,
      properties: {
        tsconfig: projectPath(),
        modelsDirectory: projectPath(),
        rules: {
          type: 'object',
          minProperties: 1,
          additionalProperties: {
            type: 'object',
            required: ['includePaths'],
            additionalProperties: false,
            properties: {
              includePaths: projectPaths('Project-relative directories scanned by the rule.'),
              allowedPathPatterns: regexPatterns('Regular expressions exempted from the rule.'),
            },
          },
        },
      },
    },
    workspaceManifestGuard: {
      type: 'object',
      required: ['packageRoots', 'requireWorkspaceProtocol', 'peerRequirements'],
      additionalProperties: false,
      properties: {
        packageRoots: projectPaths('Directories whose direct children contain workspace package manifests.'),
        requireWorkspaceProtocol: { type: 'boolean' },
        peerRequirements: {
          type: 'array',
          items: {
            type: 'object',
            required: ['dependency', 'providers', 'consumers'],
            additionalProperties: false,
            properties: {
              dependency: { type: 'string', minLength: 1 },
              providers: projectPaths('Workspace packages that must expose the dependency as a peer.'),
              consumers: projectPaths('Workspace packages that must declare the dependency directly at runtime.'),
            },
          },
        },
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
        removableFilePatterns: regexPatterns('Regular expressions matched against file names.'),
        removableSpecificFiles: projectPaths('Exact project-relative removable files.', 0),
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
        target: projectPath('Paired-document path template; supports {basename} and {stem}.'),
        index: projectPath('Optional index that must link to each paired document exactly once.'),
        table: {
          type: 'object',
          required: ['header', 'fileColumn'],
          additionalProperties: false,
          properties: {
            header: stringArray('Exact Markdown table header cells.', { minItems: 1 }),
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
        files: projectPaths('Glob patterns selecting collection documents.'),
        exclude: projectPaths('Glob patterns excluded from the collection.', 0),
        index: projectPath('Index that must link to every collection document exactly once.'),
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
        files: projectPaths('Glob patterns selecting Markdown files to inspect.'),
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
                entrypoints: projectPaths('Glob patterns selecting reachability roots.'),
                files: projectPaths('Glob patterns selecting documents that must be reachable.'),
              },
            },
          },
        },
        requiredFiles: projectPaths('Exact repository-relative files that must exist.', 0),
        collections: { type: 'array', minItems: 1, items: { $ref: '#/$defs/documentationCollection' } },
        inventories: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['document', 'sources'],
            additionalProperties: false,
            properties: {
              document: projectPath('Markdown inventory document.'),
              sources: projectPaths('Glob or exact path patterns whose matches must be listed as inline code.'),
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
        path: projectPath(),
      },
    },
    workspaceTests: {
      type: 'object',
      description: 'Workspace targets and failure-report behavior for test commands.',
      required: ['workspaces'],
      additionalProperties: false,
      properties: {
        workspaces: { type: 'array', minItems: 1, items: { $ref: '#/$defs/workspaceTarget' } },
        errorLogFile: { ...projectPath(), default: 'tests_output_errors.log' },
        testFilePattern: { type: 'string', format: 'regex', default: '\\.(test|spec)\\.(ts|tsx|js|jsx)$' },
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
        failFast: { type: 'boolean', default: false },
        steps: { type: 'array', minItems: 1, items: { $ref: '#/$defs/taskStep' } },
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
          minItems: 1,
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
              files: projectPaths('Focused Vitest files.', 0),
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
        steps: { type: 'array', minItems: 1, items: { $ref: '#/$defs/taskStep' } },
        postSteps: { type: 'array', items: { $ref: '#/$defs/taskStep' } },
      },
    },
    jsdocReport: {
      type: 'object',
      description: 'JSDoc scan paths and report behavior.',
      required: ['includePaths'],
      additionalProperties: false,
      properties: {
        includePaths: projectPaths('Project-relative directories scanned by default.'),
        excludePatterns: regexPatterns('Regular expressions excluded from scanning.'),
        reportFile: projectPath(),
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
        appDirs: projectPaths('Frontend app directories containing dist/assets.'),
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
        protectedOverridesFile: projectPath(),
        singletonGuardCommand: { $ref: '#/$defs/commandStep' },
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
        apps: { type: 'object', minProperties: 1, additionalProperties: { $ref: '#/$defs/devApp' } },
        defaultApps: stringArray('App keys started when --apps is omitted.', { minItems: 1 }),
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
      },
    },
    devGridRow: {
      type: 'object',
      required: ['panes'],
      additionalProperties: false,
      properties: {
        panes: { type: 'array', minItems: 1, items: { $ref: '#/$defs/devGridPane' } },
      },
    },
    devGridLayout: {
      type: 'object',
      required: ['rows'],
      additionalProperties: false,
      properties: {
        rows: { type: 'array', minItems: 1, items: { $ref: '#/$defs/devGridRow' } },
      },
    },
    devGrid: {
      type: 'object',
      description: 'Terminal row layout and fallback scripts for development.',
      required: ['layout'],
      additionalProperties: false,
      properties: {
        layout: { $ref: '#/$defs/devGridLayout' },
        fallbackScript: { type: 'string' },
        silentFallbackScript: { type: 'string' },
        preflightCommand: { $ref: '#/$defs/commandStep' },
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

function staysInsideRoot(pathApi: typeof path.posix, root: string, candidate: string): boolean {
  const resolved = pathApi.resolve(root, candidate)
  const relative = pathApi.relative(root, resolved)
  return relative !== '..' && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative)
}

function isSafeProjectPath(value: string): boolean {
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false
  return (
    staysInsideRoot(path.posix, '/project', value.replaceAll('\\', '/')) &&
    staysInsideRoot(path.win32, 'C:\\project', value)
  )
}

function isValidRegex(value: string): boolean {
  try {
    new RegExp(value)
    return true
  } catch {
    return false
  }
}

function pointerToJsonPath(pointer: string): string {
  const segments = pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))

  return segments.reduce((result, segment) => (
    /^\d+$/u.test(segment)
      ? `${result}[${segment}]`
      : result ? `${result}.${segment}` : segment
  ), '')
}

function configErrorPath(error: ErrorObject): string {
  const basePath = pointerToJsonPath(error.instancePath)
  if (error.keyword === 'required') {
    const missingProperty = String(error.params.missingProperty)
    /* v8 ignore next -- the root config has no required properties */
    return basePath ? `${basePath}.${missingProperty}` : missingProperty
  }
  if (error.keyword === 'additionalProperties') {
    const additionalProperty = String(error.params.additionalProperty)
    return basePath ? `${basePath}.${additionalProperty}` : additionalProperty
  }
  return basePath || '<root>'
}

function configErrorMessage(error: ErrorObject): string {
  if (error.keyword === 'format' && error.params.format === 'project-path') {
    return 'must be a safe project-relative path'
  }
  if (error.keyword === 'format' && error.params.format === 'regex') {
    return 'must be a valid regular expression'
  }
  if (error.keyword === 'oneOf') {
    return 'must define exactly one of command or builtinGuard'
  }
  /* v8 ignore next -- Ajv always supplies messages for enabled built-in keywords */
  return error.message ?? 'is invalid'
}

const schemaValidator = new Ajv2020({
  allErrors: true,
  strict: true,
})
schemaValidator.addFormat('project-path', { type: 'string', validate: isSafeProjectPath })
schemaValidator.addFormat('regex', { type: 'string', validate: isValidRegex })
const validateSchema = schemaValidator.compile(configSchema)

export function validateConfig(value: unknown): void {
  if (validateSchema(value)) return

  const errors = Array.from(new Set(validateSchema.errors!.map((error: ErrorObject) => (
    `${configErrorPath(error)}: ${configErrorMessage(error)}`
  )))).sort()

  throw new Error([
    'Invalid .webtoolkit-cli/config.json:',
    ...errors.map((error) => `- ${error}`),
  ].join('\n'))
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
