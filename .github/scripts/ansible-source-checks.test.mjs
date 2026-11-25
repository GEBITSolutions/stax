import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ansibleTargets, checkSelection, compileGithubScripts, githubOutputs, runParser, selectionCases } from './ansible-source-checks.mjs';

const parser = join(dirname(fileURLToPath(import.meta.url)), '../actions/gh-create-deploy-config/dist/index.js');
const stack = (id, extra = {}) => ({
  id,
  type: 'ansible',
  ansible_inventory: 'ansible/inventory.yml',
  ansible_playbook: `ansible/${id}.yml`,
  'runs-on': 'ubuntu-latest',
  input: [],
  ...extra,
});
const fleet = {
  sourceFile: 'configs/ansible/k3s-arc.yaml',
  config: { stacks: [stack('k3s'), stack('arc', { depends_on: ['k3s'], input: [{ app_id: 'gh.secret.APP_ID' }] })] },
};
const levels = (selection) => runParser(parser, selection).map((layer) => layer.map(({ id }) => id));

test('the committed parser selects one stack, or a stack after its dependencies with ">"', () => {
  const cases = selectionCases([fleet]);
  assert.deepEqual(cases.map(({ filter }) => filter), ['k3s', '>k3s', 'arc', '>arc']);
  assert.deepEqual(cases.map(levels), [[['k3s']], [['k3s']], [['arc']], [['k3s'], ['arc']]]);
  for (const selection of cases) checkSelection(selection, runParser(parser, selection));
});

test('the committed parser rejects an invalid Ansible config', () => {
  const broken = { sourceFile: 'broken.yaml', config: { stacks: [stack('a', { input: [{ ansible_user: 'root' }] })] } };
  assert.throws(() => runParser(parser, { ...broken, filter: 'a' }), /rejected broken\.yaml stack_filter "a"/);
});

test('a selection must end with the requested stack and contain Ansible stacks only', () => {
  const selection = { sourceFile: 'c.yaml', filter: 'arc', id: 'arc' };
  assert.throws(() => checkSelection(selection, [[{ id: 'k3s', type: 'ansible' }]]), /"arc" is not in the last level/);
  assert.throws(() => checkSelection(selection, [[{ id: 'k3s', type: 'ansible' }], [{ id: 'arc', type: 'ansible' }]]), /expected only "arc"/);
  assert.throws(
    () => checkSelection({ ...selection, filter: '>arc' }, [[{ id: 'net', type: 'terraform' }], [{ id: 'arc', type: 'ansible' }]]),
    /"net" is not an Ansible stack/,
  );
});

test('GitHub scripts compile with the actions/github-script bindings', () => {
  const workflow = (script) => ({ file: 'w.yml', workflow: { jobs: { j: { steps: [{ name: 's', uses: 'actions/github-script@v8', with: { script } }] } } } });
  compileGithubScripts([workflow("const x = await github.rest.repos.get(context.repo); core.setOutput('x', x);")]);
  assert.throws(() => compileGithubScripts([workflow('const = 1')]), /w\.yml, step "s"/);
  compileGithubScripts([workflow('await github.rest.issues.get({ issue_number: ${{ inputs.pr_number }}, title: "${{ github.ref }}" });')]);
});

test('syntax-check targets group playbooks by inventory', () => {
  assert.deepEqual(ansibleTargets([fleet, { config: { stacks: [stack('arc'), { id: 'x', type: 'terraform' }] } }]), [
    { inventory: 'ansible/inventory.yml', playbooks: ['ansible/arc.yml', 'ansible/k3s.yml'] },
  ]);
});

test('GitHub outputs parse plain and delimited values', () => {
  assert.deepEqual(githubOutputs('a=1\nb<<EOF\nx\ny\nEOF\nc=z=2\n'), { a: '1', b: 'x\ny', c: 'z=2' });
  assert.throws(() => githubOutputs('b<<EOF\nx'), /Unterminated/);
});
