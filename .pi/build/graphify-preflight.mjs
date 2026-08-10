#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const scopeIndex = args.indexOf('--scope');
const scopeArg = scopeIndex >= 0 ? args[scopeIndex + 1] : '.';
const question = args.filter((arg, index) => arg !== '--scope' && index !== scopeIndex + 1).join(' ').trim();
const root = process.cwd();
const target = resolve(root, scopeArg ?? '.');

if (!target.startsWith(root)) throw new Error('Scope must remain inside repository root.');
if (!existsSync(target)) throw new Error(`Scope does not exist: ${scopeArg}`);

const graph = findNearestGraph(target, root);
const graphifyInstalled = commandAvailable('graphify');
const commitTime = latestCommitTime(root);
const freshness = graph ? (statSync(graph).mtimeMs / 1000 >= commitTime ? 'fresh' : 'stale') : 'missing';
const displayScope = relative(root, target) || '.';

const result = {
  scope: displayScope,
  question: question || null,
  graphify_installed: graphifyInstalled,
  graph_path: graph ? relative(root, graph) : null,
  freshness,
  use_graphify: Boolean(graph && graphifyInstalled),
  recommended_command: graph && graphifyInstalled
    ? `graphify query ${JSON.stringify(question || 'How does this scope work?')} --graph ${JSON.stringify(relative(root, graph))}`
    : graphifyInstalled
      ? `graphify extract ${JSON.stringify(displayScope)} --no-cluster`
      : 'Install Graphify before graph-assisted discovery.',
  note: graph
    ? 'Graph output is advisory. Confirm critical paths in source and tests.'
    : 'No scoped graph exists. Build only for cross-file or cross-surface work with model credentials available.',
};

console.log(JSON.stringify(result, null, 2));

function findNearestGraph(start, repositoryRoot) {
  let current = start;
  while (true) {
    const candidate = resolve(current, 'graphify-out/graph.json');
    if (existsSync(candidate)) return candidate;
    if (current === repositoryRoot) return null;
    current = dirname(current);
  }
}

function commandAvailable(command) {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function latestCommitTime(cwd) {
  try {
    return Number(execFileSync('git', ['log', '-1', '--format=%ct'], { cwd, encoding: 'utf8' }).trim()) || 0;
  } catch {
    return 0;
  }
}
