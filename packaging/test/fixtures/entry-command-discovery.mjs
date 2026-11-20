import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from '../../../tools/testing/vendor/acorn/acorn.mjs';

export const commandModules = {
  local: 'integrations/client/raw/local-setup-cli.mjs', daemon: 'adapters/mcp/local-daemon-liveness.mjs',
  raw: 'adapters/mcp/raw-command.mjs', assets: 'adapters/mcp/asset-command.mjs', methods: 'adapters/mcp/method-package-command.mjs',
  model: 'adapters/mcp/model-command.mjs', context: 'adapters/mcp/context-read-configuration.mjs', safety: 'adapters/mcp/safety-command.mjs',
};
const argumentZero = node => node?.type === 'MemberExpression' && node.object?.name === 'args' && node.property?.value === 0;
function visit(node, fn) {
  if (!node || typeof node.type !== 'string') return; fn(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) visit(child, fn);
    else if (value && typeof value === 'object') visit(value, fn);
  }
}
export function discoverEntryCommands(root) {
  const ast = file => parse(readFileSync(resolve(root, file), 'utf8'), { ecmaVersion: 2025, sourceType: 'module' });
  const roots = new Set();
  for (const file of ['packaging/bin/cairn-memory.mjs', 'adapters/mcp/cli.mjs']) visit(ast(file), node => {
    if (node.type === 'BinaryExpression' && argumentZero(node.left) && typeof node.right.value === 'string') roots.add(node.right.value);
  });
  const rows = new Set([...roots].filter(name => !Object.hasOwn(commandModules, name)));
  // The no-subcommand fallthrough and check-config context alias are separate
  // dispatch routes; their names are asserted from the start() AST below.
  rows.add('server');
  let alias = false;
  visit(ast('adapters/mcp/cli.mjs'), node => {
    if (node.type === 'BinaryExpression' && node.left?.object?.name === 'args' && node.left.property?.value === 1 && node.right.value === 'context') alias = true;
  });
  if (alias) rows.add('--check-config context');
  for (const [group, file] of Object.entries(commandModules)) {
    if (!roots.has(group)) throw Error('census_missing_command_root:' + group);
    const operations = new Set();
    visit(ast(file), node => {
      if (node.type === 'BinaryExpression' && argumentZero(node.left) && typeof node.right.value === 'string') operations.add(node.right.value);
      if (node.type === 'CallExpression' && node.callee?.property?.name === 'includes' && node.callee.object?.type === 'ArrayExpression' &&
          (argumentZero(node.arguments[0]) || ['operation', 'action'].includes(node.arguments[0]?.name))) {
        for (const entry of node.callee.object.elements) if (typeof entry.value === 'string') operations.add(entry.value);
      }
      if (group === 'assets' && node.type === 'VariableDeclarator' && node.id.name === 'flags' && node.init?.type === 'ObjectExpression')
        for (const property of node.init.properties) operations.add(property.key.name ?? property.key.value);
    });
    if (group === 'safety') visit(ast('adapters/mcp/safety-migrate-command.mjs'), node => {
      if (node.type === 'BinaryExpression' && argumentZero(node.left) && typeof node.right.value === 'string') operations.add(node.right.value);
    });
    for (const operation of operations) if (operation !== '-h') rows.add(group + ' ' + operation);
  }
  return [...rows].sort();
}
