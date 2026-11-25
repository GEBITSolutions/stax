import { describe, expect, it } from '@jest/globals'
import {
  validateAnsibleConfig,
  validateAnsibleLayerOverlap,
  validateAnsibleSelection
} from '../src/validateAnsibleConfig.js'
import { ITerraformConfig, ITerraformLayerConfig } from '../src/types.js'

function ansible(overrides: Record<string, unknown> = {}): ITerraformConfig {
  return {
    id: 'linux-arc',
    type: 'ansible',
    ansible_inventory: 'ansible/inventory.yml',
    ansible_playbook: 'ansible/arc.yml',
    'runs-on': 'ubuntu-latest-large',
    depends_on: ['linux-k3s'],
    input: [
      { arc_github_app_id: 'gh.secret.ARC_GITHUB_APP_ID' },
      { arc_ghcr_pull_token: 'gh.secret.GHCR_PULL_TOKEN' }
    ],
    ...overrides
  } as ITerraformConfig
}

describe('validateAnsibleConfig', () => {
  it('accepts the fleet stack shape, with or without inputs', () => {
    expect(() => validateAnsibleConfig(ansible())).not.toThrow()
    expect(() => validateAnsibleConfig(ansible({ input: [] }))).not.toThrow()
    expect(() =>
      validateAnsibleConfig(ansible({ input: undefined }))
    ).not.toThrow()
  })

  it('ignores other stack types', () => {
    expect(() =>
      validateAnsibleConfig({ id: 'net', type: 'terraform', folder: 'net' })
    ).not.toThrow()
  })

  it.each([
    ['id', { id: 'linux arc' }, 'invalid id'],
    [
      'missing inventory',
      { ansible_inventory: undefined },
      'invalid ansible_inventory: must be a nonempty'
    ],
    [
      'absolute path',
      { ansible_inventory: '/etc/hosts.yml' },
      'must be repository-relative'
    ],
    [
      'drive path',
      { ansible_playbook: 'C:/site.yml' },
      'must be repository-relative'
    ],
    [
      'backslash',
      { ansible_playbook: 'ansible\\site.yml' },
      'POSIX separators'
    ],
    [
      'parent segment',
      { ansible_playbook: '../site.yml' },
      'parent or empty path segments'
    ],
    [
      'empty segment',
      { ansible_playbook: 'ansible//site.yml' },
      'parent or empty path segments'
    ],
    [
      'control character',
      { ansible_playbook: 'site\n.yml' },
      'control characters'
    ],
    [
      'non-YAML file',
      { ansible_playbook: 'ansible/site.json' },
      '.yml or .yaml'
    ],
    ['missing runner', { 'runs-on': undefined }, 'invalid runs-on'],
    ['runner list', { 'runs-on': ['self-hosted', 'linux'] }, 'invalid runs-on'],
    ['input object', { input: { token: 'x' } }, 'must be a list'],
    ['string input', { input: ['gh.secret.TOKEN'] }, 'single-key mapping'],
    ['two-key input', { input: [{ a: 'x', b: 'y' }] }, 'single-key mapping'],
    [
      'invalid name',
      { input: [{ 'app-token': 'x' }] },
      'not a valid variable name'
    ],
    [
      'ansible_ name',
      { input: [{ ANSIBLE_become_pass: 'x' }] },
      'reserved for Ansible'
    ],
    ['magic variable', { input: [{ hostvars: 'x' }] }, 'reserved for Ansible'],
    ['environment', { input: [{ Environment: 'x' }] }, 'reserved for Ansible'],
    [
      'duplicate name',
      { input: [{ token: 'a' }, { token: 'b' }] },
      'declared twice'
    ],
    ['source_repo', { source_repo: 'shared' }, 'external sources'],
    ['source_version', { source_version: 'main' }, 'external sources'],
    ['output-var', { 'output-var': ['host'] }, 'outputs are not supported'],
    [
      'output-secret',
      { 'output-secret': ['key'] },
      'outputs are not supported'
    ],
    ['destroy', { destroy: 'true' }, 'destroy is not supported'],
    ['secret_backend', { secret_backend: 'keyvault' }, 'only gh is supported']
  ])('rejects %s', (_case, overrides, message) => {
    expect(() => validateAnsibleConfig(ansible(overrides))).toThrow(message)
  })

  it('accepts empty source and output fields', () => {
    expect(() =>
      validateAnsibleConfig(
        ansible({
          source_repo: '',
          source_version: '',
          'output-var': [],
          'output-secret': [],
          destroy: false
        })
      )
    ).not.toThrow()
  })
})

describe('validateAnsibleSelection', () => {
  it('rejects destroy for a selection containing an Ansible stack', () => {
    const terraform = { id: 'net', type: 'terraform', folder: 'net' }
    expect(() =>
      validateAnsibleSelection([terraform, ansible()], { destroy: 'true' })
    ).toThrow('Ansible stack "linux-arc" does not support destroy=true.')
    expect(() =>
      validateAnsibleSelection([terraform, ansible()], { destroy: true })
    ).toThrow('does not support destroy')
    expect(() =>
      validateAnsibleSelection([terraform, ansible()], { destroy: 'false' })
    ).not.toThrow()
    expect(() =>
      validateAnsibleSelection([terraform], { destroy: 'true' })
    ).not.toThrow()
  })
})

describe('validateAnsibleLayerOverlap', () => {
  const layer = (
    config: ITerraformConfig,
    level = 0
  ): ITerraformLayerConfig => ({
    ...config,
    layer: level
  })

  it('rejects two stacks sharing an inventory in one level, including "./" aliases', () => {
    expect(() =>
      validateAnsibleLayerOverlap([
        [
          layer(ansible({ id: 'k3s' })),
          layer(
            ansible({ id: 'arc', ansible_inventory: './ansible/inventory.yml' })
          )
        ]
      ])
    ).toThrow(
      'Ansible stacks "k3s" and "arc" share inventory "ansible/inventory.yml" in one level'
    )
  })

  it('accepts a shared inventory across levels and distinct inventories in one level', () => {
    expect(() =>
      validateAnsibleLayerOverlap([
        [
          layer(ansible({ id: 'k3s' })),
          layer(
            ansible({ id: 'other', ansible_inventory: 'ansible/other.yml' })
          )
        ],
        [layer(ansible({ id: 'arc' }), 1)]
      ])
    ).not.toThrow()
  })
})
