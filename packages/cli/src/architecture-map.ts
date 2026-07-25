import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import type { WebToolkitCliConfig } from './config.js'
import { resolveDependencyCruiserBin } from './guards/dependency-cruiser-guard.js'

type CruiseRule = {
  name: string
  severity?: string
}

type CruiseDependency = {
  module: string
  resolved: string
  coreModule?: boolean
  couldNotResolve?: boolean
  circular?: boolean
  valid?: boolean
  rules?: CruiseRule[]
}

type CruiseModule = {
  source: string
  dependencies: CruiseDependency[]
  valid?: boolean
  rules?: CruiseRule[]
}

type CruiseResult = {
  modules: CruiseModule[]
}

export type ArchitectureNodeKind = 'repository' | 'package' | 'directory' | 'file'

export type ArchitectureNode = {
  id: string
  parentId?: string
  name: string
  path: string
  kind: ArchitectureNodeKind
  children: string[]
  fileCount: number
  imports: string[]
  importedBy: string[]
  externalImports: string[]
  circular: boolean
  violations: string[]
}

export type ArchitectureMapModel = {
  rootId: string
  generatedAt: string
  nodes: Record<string, ArchitectureNode>
  summary: {
    files: number
    dependencies: number
    externalDependencies: number
    violations: number
  }
}

type ArchitectureMapRuntime = {
  cwd: string
  config: WebToolkitCliConfig
}

type ArchitectureMapOptions = {
  now?: Date
  resolveBin?: () => string
  spawn?: typeof spawnSync
}

const GENERATED_PATH_PATTERN = '(^|/)(node_modules|dist|build|coverage|\\.git)(/|$)'

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '')
}

function belongsToScopes(file: string, scopes: string[]): boolean {
  return scopes.some((scope) => file === scope || file.startsWith(`${scope}/`))
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function readPackageName(cwd: string, directory: string): string | null {
  const manifestPath = path.join(cwd, directory, 'package.json')
  if (!existsSync(manifestPath)) return null
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown }
    return typeof manifest.name === 'string' && manifest.name ? manifest.name : null
  } catch {
    return null
  }
}

function collectPackageNames(cwd: string, files: string[]): Map<string, string> {
  const checked = new Set<string>()
  const packages = new Map<string, string>()
  for (const file of files) {
    const segments = file.split('/').slice(0, -1)
    for (let length = 1; length <= segments.length; length += 1) {
      const directory = segments.slice(0, length).join('/')
      if (checked.has(directory)) continue
      checked.add(directory)
      const packageName = readPackageName(cwd, directory)
      if (packageName) packages.set(directory, packageName)
    }
  }
  return packages
}

function nodeId(kind: 'directory' | 'file', relativePath: string): string {
  return `${kind}:${relativePath}`
}

function createNode(
  id: string,
  parentId: string | undefined,
  name: string,
  relativePath: string,
  kind: ArchitectureNodeKind,
): ArchitectureNode {
  return {
    id,
    parentId,
    name,
    path: relativePath,
    kind,
    children: [],
    fileCount: 0,
    imports: [],
    importedBy: [],
    externalImports: [],
    circular: false,
    violations: [],
  }
}

function ruleLabels(rules: CruiseRule[] | undefined): string[] {
  return (rules ?? []).map((rule) => rule.severity ? `${rule.severity}: ${rule.name}` : rule.name)
}

export function buildArchitectureMapModel(
  result: CruiseResult,
  cwd: string,
  includePaths: string[],
  generatedAt = new Date().toISOString(),
): ArchitectureMapModel {
  const scopes = includePaths.map(normalizePath)
  const modules = result.modules
    .map((module) => ({ ...module, source: normalizePath(module.source) }))
    .filter((module) => belongsToScopes(module.source, scopes))
  const filePaths = modules.map((module) => module.source)
  const fileSet = new Set(filePaths)
  const packageNames = collectPackageNames(cwd, filePaths)
  const rootId = 'repository:.'
  const nodes: Record<string, ArchitectureNode> = {
    [rootId]: createNode(rootId, undefined, path.basename(cwd), '.', 'repository'),
  }

  for (const file of filePaths) {
    let parentId = rootId
    nodes[rootId].fileCount += 1
    const segments = file.split('/')
    for (let index = 0; index < segments.length - 1; index += 1) {
      const directory = segments.slice(0, index + 1).join('/')
      const id = nodeId('directory', directory)
      if (!nodes[id]) {
        const packageName = packageNames.get(directory)
        nodes[id] = createNode(
          id,
          parentId,
          packageName ?? segments[index],
          directory,
          packageName ? 'package' : 'directory',
        )
        nodes[parentId].children.push(id)
      }
      nodes[id].fileCount += 1
      parentId = id
    }

    const id = nodeId('file', file)
    nodes[id] = createNode(id, parentId, segments.at(-1)!, file, 'file')
    nodes[id].fileCount = 1
    nodes[parentId].children.push(id)
  }

  let dependencyCount = 0
  let externalDependencyCount = 0
  for (const module of modules) {
    const sourceId = nodeId('file', module.source)
    const sourceNode = nodes[sourceId]
    const violations = [...ruleLabels(module.rules)]

    for (const dependency of module.dependencies) {
      const resolved = normalizePath(dependency.resolved)
      const labels = ruleLabels(dependency.rules)
      violations.push(...labels)
      sourceNode.circular ||= dependency.circular === true
      dependencyCount += 1

      if (fileSet.has(resolved)) {
        const targetId = nodeId('file', resolved)
        sourceNode.imports.push(targetId)
        nodes[targetId].importedBy.push(sourceId)
      } else {
        externalDependencyCount += 1
        sourceNode.externalImports.push(
          dependency.couldNotResolve ? `${dependency.module} (unresolved)` : dependency.module,
        )
      }
    }

    sourceNode.imports = uniqueSorted(sourceNode.imports)
    sourceNode.externalImports = uniqueSorted(sourceNode.externalImports)
    sourceNode.violations = uniqueSorted(violations)
  }

  for (const node of Object.values(nodes)) {
    node.children.sort((leftId, rightId) => {
      const left = nodes[leftId]
      const right = nodes[rightId]
      return Number(left.kind === 'file') - Number(right.kind === 'file') || left.name.localeCompare(right.name)
    })
    node.importedBy = uniqueSorted(node.importedBy)
  }

  return {
    rootId,
    generatedAt,
    nodes,
    summary: {
      files: filePaths.length,
      dependencies: dependencyCount,
      externalDependencies: externalDependencyCount,
      violations: Object.values(nodes).reduce((count, node) => count + node.violations.length, 0),
    },
  }
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
}

export function initialGraphExpansion(model: ArchitectureMapModel, maximumDepth = 1): string[] {
  const expanded = new Set([model.rootId])
  if (maximumDepth === 0) return [...expanded]

  const expandDescendants = (parentId: string, depth: number): void => {
    if (depth > maximumDepth) return
    for (const childId of model.nodes[parentId].children) {
      if (model.nodes[childId].children.length === 0) continue
      expanded.add(childId)
      expandDescendants(childId, depth + 1)
    }
  }

  for (const childId of model.nodes[model.rootId].children) {
    const packageIds = [childId, ...model.nodes[childId].children]
      .filter((id) => model.nodes[id].kind === 'package')
    if (packageIds.length === 0) continue
    expanded.add(childId)
    if (maximumDepth === 1) continue
    packageIds.forEach((id) => {
      expanded.add(id)
      expandDescendants(id, 3)
    })
  }
  return [...expanded]
}

export function renderArchitectureMap(model: ArchitectureMapModel, initialExpandedDepth = 1): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Architecture map</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #0b1020; color: #e5e7eb; }
    * { box-sizing: border-box; }
    body { margin: 0; height: 100vh; overflow: hidden; }
    header { display: flex; align-items: center; gap: 1.5rem; padding: .85rem 1rem; border-bottom: 1px solid #27324a; background: #11182b; }
    h1, h2 { margin: 0; }
    h1 { font-size: 1.25rem; }
    .summary { margin: .25rem 0 0; color: #9ca3af; font-size: .82rem; }
    .search { display: flex; gap: .45rem; flex: 1; max-width: 38rem; margin-left: auto; }
    input, button { border: 1px solid #334155; border-radius: .45rem; padding: .55rem .7rem; background: #0b1020; color: inherit; }
    input { flex: 1; min-width: 8rem; }
    button { cursor: pointer; }
    button:hover { background: #1e293b; }
    main { display: grid; grid-template-columns: minmax(0, 1fr) 22rem; height: calc(100vh - 4.8rem); }
    .graph-panel { position: relative; min-width: 0; overflow: hidden; background: radial-gradient(circle at 50% 50%, #121b31, #0b1020 70%); }
    .graph-toolbar { position: absolute; z-index: 2; top: .75rem; left: .75rem; display: flex; align-items: center; gap: .4rem; padding: .4rem; border: 1px solid #27324a; border-radius: .55rem; background: #11182be8; box-shadow: 0 .4rem 1rem #0005; }
    .graph-toolbar button { min-width: 2.2rem; padding: .38rem .55rem; }
    .graph-status { margin-left: .4rem; color: #94a3b8; font-size: .78rem; white-space: nowrap; }
    svg { display: block; width: 100%; height: 100%; cursor: grab; touch-action: none; user-select: none; }
    svg.dragging { cursor: grabbing; }
    .hierarchy-edge { fill: none; stroke: #475569; stroke-width: 1.5; }
    .hierarchy-edge.critical { stroke: #38bdf8; stroke-width: 3; }
    .dependency-edge { fill: none; stroke: #64748b; stroke-width: 1.25; stroke-dasharray: 5 5; opacity: .55; marker-end: url(#dependency-arrow); }
    .dependency-edge.outgoing { stroke: #4ade80; stroke-width: 2.5; opacity: .95; }
    .dependency-edge.incoming { stroke: #fbbf24; stroke-width: 2.5; opacity: .95; }
    .edge-count { fill: #94a3b8; font-size: 10px; paint-order: stroke; stroke: #0b1020; stroke-width: 3px; }
    .graph-node { cursor: pointer; outline: none; }
    .graph-node rect { fill: #172036; stroke: #475569; stroke-width: 1.25; rx: 7; }
    .graph-node.package rect { fill: #1e293b; stroke: #818cf8; }
    .graph-node.file rect { fill: #111827; }
    .graph-node text { fill: #e5e7eb; font-size: 12px; pointer-events: none; }
    .graph-node .node-kind { fill: #94a3b8; font-size: 9px; text-transform: uppercase; }
    .graph-node:hover rect, .graph-node:focus rect { stroke: #e2e8f0; stroke-width: 2; }
    .graph-node.selected rect { fill: #1d4ed8; stroke: #93c5fd; stroke-width: 3; }
    .graph-node.ancestor rect { stroke: #38bdf8; stroke-width: 2.5; }
    .graph-node.dependency-out rect { fill: #14532d; stroke: #4ade80; stroke-width: 2.5; }
    .graph-node.dependency-in rect { fill: #713f12; stroke: #fbbf24; stroke-width: 2.5; }
    .toggle { cursor: pointer; }
    .toggle circle { fill: #0b1020; stroke: #64748b; }
    .toggle text { fill: #cbd5e1; font-size: 13px; text-anchor: middle; }
    aside { padding: 1rem 1.1rem; overflow: auto; border-left: 1px solid #27324a; background: #11182b; }
    .legend { display: flex; gap: .8rem; flex-wrap: wrap; margin: .75rem 0 1rem; color: #94a3b8; font-size: .75rem; }
    .legend span::before { content: ""; display: inline-block; width: .65rem; height: .65rem; margin-right: .35rem; border-radius: .15rem; background: var(--color); }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: .5rem 1rem; margin: 1.25rem 0; }
    dt { color: #94a3b8; }
    dd { margin: 0; overflow-wrap: anywhere; }
    h3 { margin: 1.3rem 0 .5rem; font-size: .95rem; color: #cbd5e1; }
    ul { margin: 0; padding-left: 1.25rem; }
    .link { border: 0; padding: .15rem 0; background: none; color: #7dd3fc; cursor: pointer; text-align: left; }
    .empty { color: #64748b; font-style: italic; }
    @media (max-width: 800px) {
      header { align-items: stretch; flex-direction: column; gap: .6rem; }
      .search { width: 100%; max-width: none; margin: 0; }
      main { grid-template-columns: 1fr; grid-template-rows: minmax(55vh, 1fr) auto; height: calc(100vh - 8.5rem); overflow: auto; }
      aside { max-height: 40vh; border-top: 1px solid #27324a; border-left: 0; }
    }
  </style>
</head>
<body>
  <header>
    <div><h1>Architecture graph</h1><p class="summary" id="summary"></p></div>
    <form class="search" id="search-form">
      <input id="search" type="search" autocomplete="off" placeholder="Locate package, directory, or file path" aria-label="Locate node">
      <button type="submit">Locate</button>
    </form>
  </header>
  <main>
    <section class="graph-panel" aria-label="Interactive architecture graph">
      <div class="graph-toolbar">
        <button type="button" id="zoom-out" aria-label="Zoom out">−</button>
        <button type="button" id="zoom-in" aria-label="Zoom in">+</button>
        <button type="button" id="fit-graph">Fit</button>
        <button type="button" id="reset-graph">Reset</button>
        <span class="graph-status" id="graph-status"></span>
      </div>
      <svg id="architecture-graph" role="img" aria-label="Architecture hierarchy and dependencies">
        <defs>
          <marker id="dependency-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"></path>
          </marker>
        </defs>
        <rect id="canvas-background" width="100%" height="100%" fill="transparent"></rect>
        <g id="viewport">
          <g id="hierarchy-edges"></g>
          <g id="dependency-edges"></g>
          <g id="edge-labels"></g>
          <g id="graph-nodes"></g>
        </g>
      </svg>
    </section>
    <aside id="details" aria-live="polite">
      <div class="legend">
        <span style="--color:#1d4ed8">Selected</span>
        <span style="--color:#38bdf8">Hierarchy</span>
        <span style="--color:#14532d">Imports</span>
        <span style="--color:#713f12">Imported by</span>
      </div>
      <div id="detail-content"></div>
    </aside>
  </main>
  <script id="architecture-data" type="application/json">${safeJson({
    model,
    initialExpanded: initialGraphExpansion(model, initialExpandedDepth),
  })}</script>
  <script>
    const payload = JSON.parse(document.getElementById('architecture-data').textContent);
    const model = payload.model;
    const nodes = model.nodes;
    const svg = document.getElementById('architecture-graph');
    const viewport = document.getElementById('viewport');
    const hierarchyLayer = document.getElementById('hierarchy-edges');
    const dependencyLayer = document.getElementById('dependency-edges');
    const labelLayer = document.getElementById('edge-labels');
    const nodeLayer = document.getElementById('graph-nodes');
    const detailsPanel = document.getElementById('detail-content');
    const expanded = new Set(payload.initialExpanded);
    const positions = new Map();
    const NODE_WIDTH = 190;
    const NODE_HEIGHT = 42;
    const COLUMN_GAP = 255;
    const ROW_GAP = 66;
    let graphBounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    let transform = { x: 0, y: 0, scale: 1 };
    let selectedId = model.rootId;
    let dragging = null;

    document.getElementById('summary').textContent =
      model.summary.files + ' files · ' + model.summary.dependencies + ' dependencies · ' +
      model.summary.externalDependencies + ' external · ' + model.summary.violations + ' violations';

    function svgElement(name, attributes) {
      const element = document.createElementNS('http://www.w3.org/2000/svg', name);
      Object.entries(attributes || {}).forEach(function (entry) {
        element.setAttribute(entry[0], String(entry[1]));
      });
      return element;
    }

    function visibleHierarchy() {
      const visible = [];
      function visit(id, depth) {
        visible.push({ id: id, depth: depth });
        if (!expanded.has(id)) return;
        nodes[id].children.forEach(function (childId) { visit(childId, depth + 1); });
      }
      visit(model.rootId, 0);
      return visible;
    }

    function layoutHierarchy(visible) {
      const visibleSet = new Set(visible.map(function (entry) { return entry.id; }));
      positions.clear();
      let nextRow = 0;
      function place(id, depth) {
        const children = expanded.has(id)
          ? nodes[id].children.filter(function (childId) { return visibleSet.has(childId); })
          : [];
        let y;
        if (!children.length) {
          y = 40 + nextRow * ROW_GAP;
          nextRow += 1;
        } else {
          const childPositions = children.map(function (childId) { return place(childId, depth + 1); });
          y = childPositions.reduce(function (sum, position) { return sum + position.y; }, 0) / childPositions.length;
        }
        const position = { x: 40 + depth * COLUMN_GAP, y: y, depth: depth };
        positions.set(id, position);
        return position;
      }
      place(model.rootId, 0);
      graphBounds = {
        minX: 40 - NODE_WIDTH / 2,
        minY: Math.min.apply(null, [...positions.values()].map(function (position) { return position.y; })) - NODE_HEIGHT,
        maxX: Math.max.apply(null, [...positions.values()].map(function (position) { return position.x; })) + NODE_WIDTH / 2,
        maxY: Math.max.apply(null, [...positions.values()].map(function (position) { return position.y; })) + NODE_HEIGHT,
      };
      return visibleSet;
    }

    function representative(fileId, visibleSet) {
      let id = fileId;
      while (id && !visibleSet.has(id)) id = nodes[id].parentId;
      return id || model.rootId;
    }

    function isInside(id, ancestorId) {
      let current = id;
      while (current) {
        if (current === ancestorId) return true;
        current = nodes[current].parentId;
      }
      return false;
    }

    function aggregateDependencies(visibleSet) {
      const edges = new Map();
      Object.values(nodes).forEach(function (node) {
        if (node.kind !== 'file') return;
        node.imports.forEach(function (targetId) {
          const source = representative(node.id, visibleSet);
          const target = representative(targetId, visibleSet);
          if (source === target) return;
          const key = source + '\\u0000' + target;
          const edge = edges.get(key) || { source: source, target: target, count: 0, outgoing: false, incoming: false };
          edge.count += 1;
          const sourceSelected = isInside(node.id, selectedId);
          const targetSelected = isInside(targetId, selectedId);
          edge.outgoing ||= sourceSelected && !targetSelected;
          edge.incoming ||= targetSelected && !sourceSelected;
          edges.set(key, edge);
        });
      });
      return [...edges.values()];
    }

    function criticalPath() {
      const ids = new Set();
      let current = selectedId;
      while (current) {
        ids.add(current);
        current = nodes[current].parentId;
      }
      return ids;
    }

    function edgePath(source, target) {
      const startX = source.x + NODE_WIDTH / 2;
      const endX = target.x - NODE_WIDTH / 2;
      const distance = Math.max(45, Math.abs(endX - startX) / 2);
      const direction = endX >= startX ? 1 : -1;
      return 'M ' + startX + ' ' + source.y +
        ' C ' + (startX + distance * direction) + ' ' + source.y +
        ', ' + (endX - distance * direction) + ' ' + target.y +
        ', ' + endX + ' ' + target.y;
    }

    function renderGraph() {
      const visible = visibleHierarchy();
      const visibleSet = layoutHierarchy(visible);
      const dependencies = aggregateDependencies(visibleSet);
      const critical = criticalPath();
      const outgoingNodes = new Set();
      const incomingNodes = new Set();
      dependencies.forEach(function (edge) {
        if (edge.outgoing) outgoingNodes.add(edge.target);
        if (edge.incoming) incomingNodes.add(edge.source);
      });
      hierarchyLayer.replaceChildren();
      dependencyLayer.replaceChildren();
      labelLayer.replaceChildren();
      nodeLayer.replaceChildren();

      visible.forEach(function (entry) {
        const node = nodes[entry.id];
        const target = positions.get(entry.id);
        if (node.parentId && visibleSet.has(node.parentId)) {
          const source = positions.get(node.parentId);
          const edge = svgElement('path', {
            d: edgePath(source, target),
            class: 'hierarchy-edge' + (critical.has(entry.id) ? ' critical' : ''),
          });
          hierarchyLayer.append(edge);
        }
      });

      dependencies.forEach(function (edge) {
        const source = positions.get(edge.source);
        const target = positions.get(edge.target);
        const className = 'dependency-edge' +
          (edge.outgoing ? ' outgoing' : '') +
          (edge.incoming ? ' incoming' : '');
        const pathElement = svgElement('path', { d: edgePath(source, target), class: className });
        const title = svgElement('title');
        title.textContent = nodes[edge.source].path + ' → ' + nodes[edge.target].path + ' (' + edge.count + ')';
        pathElement.append(title);
        dependencyLayer.append(pathElement);
        if (edge.count > 1) {
          const label = svgElement('text', {
            x: (source.x + target.x) / 2,
            y: (source.y + target.y) / 2 - 4,
            class: 'edge-count',
          });
          label.textContent = String(edge.count);
          labelLayer.append(label);
        }
      });

      visible.forEach(function (entry) {
        const node = nodes[entry.id];
        const position = positions.get(entry.id);
        const classNames = ['graph-node', node.kind];
        if (entry.id === selectedId) classNames.push('selected');
        else if (critical.has(entry.id)) classNames.push('ancestor');
        if (outgoingNodes.has(entry.id)) classNames.push('dependency-out');
        if (incomingNodes.has(entry.id)) classNames.push('dependency-in');
        const group = svgElement('g', {
          transform: 'translate(' + position.x + ' ' + position.y + ')',
          class: classNames.join(' '),
          tabindex: '0',
          role: 'button',
          'aria-label': node.kind + ' ' + node.path,
          'data-node-id': entry.id,
        });
        const rectangle = svgElement('rect', {
          x: -NODE_WIDTH / 2,
          y: -NODE_HEIGHT / 2,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
        });
        const kind = svgElement('text', { x: -NODE_WIDTH / 2 + 10, y: -5, class: 'node-kind' });
        kind.textContent = node.kind;
        const label = svgElement('text', { x: -NODE_WIDTH / 2 + 10, y: 12 });
        label.textContent = node.name.length > 25 ? node.name.slice(0, 24) + '…' : node.name;
        const title = svgElement('title');
        title.textContent = node.path + (node.kind === 'file' ? '' : ' · ' + node.fileCount + ' files');
        group.append(rectangle, kind, label, title);
        group.addEventListener('click', function () { selectNode(entry.id); });
        group.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') selectNode(entry.id);
          if (event.key === ' ') {
            event.preventDefault();
            toggleNode(entry.id);
          }
        });
        if (node.children.length) {
          const toggle = svgElement('g', {
            class: 'toggle',
            transform: 'translate(' + (NODE_WIDTH / 2 - 15) + ' 0)',
            role: 'button',
            'aria-label': expanded.has(entry.id) ? 'Collapse node' : 'Expand node',
          });
          const circle = svgElement('circle', { r: 10 });
          const symbol = svgElement('text', { y: 4 });
          symbol.textContent = expanded.has(entry.id) ? '−' : '+';
          toggle.append(circle, symbol);
          toggle.addEventListener('click', function (event) {
            event.stopPropagation();
            toggleNode(entry.id);
          });
          group.append(toggle);
        }
        nodeLayer.append(group);
      });

      document.getElementById('graph-status').textContent =
        visible.length + ' visible nodes · ' + dependencies.length + ' visible relations';
      applyTransform();
    }

    function addList(title, values, linked) {
      const heading = document.createElement('h3');
      heading.textContent = title;
      detailsPanel.append(heading);
      if (!values.length) {
        const empty = document.createElement('p');
        empty.className = 'empty';
        empty.textContent = 'None';
        detailsPanel.append(empty);
        return;
      }
      const list = document.createElement('ul');
      values.forEach(function (value) {
        const item = document.createElement('li');
        if (linked && nodes[value]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'link';
          button.textContent = nodes[value].path;
          button.addEventListener('click', function () { revealNode(value); });
          item.append(button);
        } else {
          item.textContent = value;
        }
        list.append(item);
      });
      detailsPanel.append(list);
    }

    function renderDetails(node) {
      detailsPanel.replaceChildren();
      const title = document.createElement('h2');
      title.textContent = node.name;
      const facts = document.createElement('dl');
      [['Kind', node.kind], ['Path', node.path], ['Files', String(node.fileCount)], ['Circular', node.circular ? 'Yes' : 'No']]
        .forEach(function (entry) {
          const term = document.createElement('dt');
          const description = document.createElement('dd');
          term.textContent = entry[0];
          description.textContent = entry[1];
          facts.append(term, description);
        });
      detailsPanel.append(title, facts);
      addList('Imports', node.imports, true);
      addList('Imported by', node.importedBy, true);
      addList('External or unresolved imports', node.externalImports, false);
      addList('Violations', node.violations, false);
    }

    function selectNode(id) {
      selectedId = id;
      renderDetails(nodes[id]);
      renderGraph();
    }

    function expandAncestors(id) {
      let current = nodes[id].parentId;
      while (current) {
        expanded.add(current);
        current = nodes[current].parentId;
      }
    }

    function revealNode(id) {
      expandAncestors(id);
      selectedId = id;
      renderDetails(nodes[id]);
      renderGraph();
      requestAnimationFrame(function () { centerNode(id); });
    }

    function toggleNode(id) {
      if (!nodes[id].children.length) return;
      if (expanded.has(id)) {
        expanded.delete(id);
        if (selectedId !== id && isInside(selectedId, id)) selectedId = id;
      } else {
        expanded.add(id);
      }
      renderDetails(nodes[selectedId]);
      renderGraph();
    }

    function applyTransform() {
      viewport.setAttribute('transform',
        'translate(' + transform.x + ' ' + transform.y + ') scale(' + transform.scale + ')');
    }

    function fitGraph() {
      const width = Math.max(1, svg.clientWidth);
      const height = Math.max(1, svg.clientHeight);
      const graphWidth = Math.max(1, graphBounds.maxX - graphBounds.minX);
      const graphHeight = Math.max(1, graphBounds.maxY - graphBounds.minY);
      transform.scale = Math.min(1.2, (width - 80) / graphWidth, (height - 80) / graphHeight);
      transform.x = (width - graphWidth * transform.scale) / 2 - graphBounds.minX * transform.scale;
      transform.y = (height - graphHeight * transform.scale) / 2 - graphBounds.minY * transform.scale;
      applyTransform();
    }

    function zoomAt(factor, clientX, clientY) {
      const rectangle = svg.getBoundingClientRect();
      const x = clientX - rectangle.left;
      const y = clientY - rectangle.top;
      const nextScale = Math.min(3, Math.max(.15, transform.scale * factor));
      transform.x = x - (x - transform.x) * (nextScale / transform.scale);
      transform.y = y - (y - transform.y) * (nextScale / transform.scale);
      transform.scale = nextScale;
      applyTransform();
    }

    function focusInitialGraph() {
      fitGraph();
      if (transform.scale < .4) {
        zoomAt(.4 / transform.scale, svg.clientWidth / 2, svg.clientHeight / 2);
      }
    }

    function centerNode(id) {
      const position = positions.get(id);
      if (!position) return;
      transform.x = svg.clientWidth / 2 - position.x * transform.scale;
      transform.y = svg.clientHeight / 2 - position.y * transform.scale;
      applyTransform();
      nodeLayer.querySelector('[data-node-id="' + CSS.escape(id) + '"]')?.focus();
    }

    document.getElementById('search-form').addEventListener('submit', function (event) {
      event.preventDefault();
      const term = document.getElementById('search').value.trim().toLowerCase();
      if (!term) return;
      const match = Object.values(nodes).find(function (node) {
        return node.path.toLowerCase() === term || node.name.toLowerCase() === term;
      }) || Object.values(nodes).find(function (node) {
        return (node.name + ' ' + node.path).toLowerCase().includes(term);
      });
      if (match) revealNode(match.id);
      else document.getElementById('graph-status').textContent = 'No node matches "' + term + '".';
    });

    document.getElementById('zoom-in').addEventListener('click', function () {
      zoomAt(1.2, svg.clientWidth / 2, svg.clientHeight / 2);
    });
    document.getElementById('zoom-out').addEventListener('click', function () {
      zoomAt(1 / 1.2, svg.clientWidth / 2, svg.clientHeight / 2);
    });
    document.getElementById('fit-graph').addEventListener('click', fitGraph);
    document.getElementById('reset-graph').addEventListener('click', function () {
      expanded.clear();
      payload.initialExpanded.forEach(function (id) { expanded.add(id); });
      selectedId = model.rootId;
      renderDetails(nodes[selectedId]);
      renderGraph();
      focusInitialGraph();
    });
    svg.addEventListener('wheel', function (event) {
      event.preventDefault();
      zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY);
    }, { passive: false });
    svg.addEventListener('pointerdown', function (event) {
      if (event.target !== svg && event.target.id !== 'canvas-background') return;
      dragging = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: transform.x, startY: transform.y };
      svg.setPointerCapture(event.pointerId);
      svg.classList.add('dragging');
    });
    svg.addEventListener('pointermove', function (event) {
      if (!dragging || dragging.pointerId !== event.pointerId) return;
      transform.x = dragging.startX + event.clientX - dragging.x;
      transform.y = dragging.startY + event.clientY - dragging.y;
      applyTransform();
    });
    svg.addEventListener('pointerup', function (event) {
      if (!dragging || dragging.pointerId !== event.pointerId) return;
      dragging = null;
      svg.releasePointerCapture(event.pointerId);
      svg.classList.remove('dragging');
    });

    renderDetails(nodes[selectedId]);
    renderGraph();
    requestAnimationFrame(focusInitialGraph);
    document.documentElement.dataset.graphReady = 'true';
  </script>
</body>
</html>
`
}

function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function resolveOutputDirectory(cwd: string, configured: string): string {
  return path.isAbsolute(configured) ? configured : path.resolve(cwd, configured)
}

function assertDirectory(target: string, label: string): void {
  if (!existsSync(target)) throw new Error(`${label} does not exist: ${target}`)
  if (!statSync(target).isDirectory()) throw new Error(`${label} is not a directory: ${target}`)
}

export function runArchitectureMap(
  runtime: ArchitectureMapRuntime,
  options: ArchitectureMapOptions = {},
): string {
  const config = runtime.config.architectureMap
  if (!config) throw new Error('architectureMap is not configured in .webtoolkit-cli/config.json.')

  for (const includePath of config.includePaths) {
    assertDirectory(path.resolve(runtime.cwd, includePath), `architectureMap.includePaths entry "${includePath}"`)
  }
  if (config.dependencyCruiserConfig) {
    const configPath = path.resolve(runtime.cwd, config.dependencyCruiserConfig)
    if (!existsSync(configPath)) {
      throw new Error(`architectureMap.dependencyCruiserConfig does not exist: ${configPath}`)
    }
  }

  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'webtoolkit-architecture-map-'))
  const resultPath = path.join(temporaryDirectory, 'cruise-result.json')
  let result: CruiseResult
  try {
    const args = [
      options.resolveBin?.() ?? resolveDependencyCruiserBin(),
      ...config.includePaths,
      ...(config.dependencyCruiserConfig
        ? ['--config', config.dependencyCruiserConfig]
        : ['--no-config']),
      '--exclude',
      GENERATED_PATH_PATTERN,
      '--do-not-follow',
      'node_modules',
      '--output-type',
      'json',
      '--output-to',
      resultPath,
      '--progress',
      'none',
    ]
    const execution = (options.spawn ?? spawnSync)(process.execPath, args, {
      cwd: runtime.cwd,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: 'inherit',
    })
    if (execution.error) throw execution.error
    if (execution.status !== 0) {
      throw new Error(`dependency-cruiser failed with exit code ${execution.status ?? 1}.`)
    }
    result = JSON.parse(readFileSync(resultPath, 'utf8')) as CruiseResult
    if (!Array.isArray(result.modules)) throw new Error('dependency-cruiser returned an invalid JSON result.')
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }

  const now = options.now ?? new Date()
  const model = buildArchitectureMapModel(result, runtime.cwd, config.includePaths, now.toISOString())
  const outputDirectory = resolveOutputDirectory(runtime.cwd, config.outputDirectory)
  mkdirSync(outputDirectory, { recursive: true })
  const outputPath = path.join(outputDirectory, `${formatDate(now)}_architecture-map.html`)
  writeFileSync(outputPath, renderArchitectureMap(model, config.initialExpandedDepth), 'utf8')
  console.info(`Architecture map: ${outputPath}`)
  console.info(`${model.summary.files} files, ${model.summary.dependencies} dependencies, ${model.summary.violations} violations.`)
  return outputPath
}
