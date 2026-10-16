import { expect, jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import { ITerraformConfig, ITerraformLayerConfig } from '../src/types.js'

jest.unstable_mockModule('@actions/core', () => core)

const {
  convert_implicit_to_explicit_dependencies,
  update_deploy_config,
  prune_external_dependencies
} = await import('../src/stackDependencyN.js')
const { apply_stack_filter } = await import('../src/stackFilterN.js')
const { generate_layerdeployment } = await import('../src/layerDeploymentN.js')

describe('update_deploy_config', () => {
  let mockConfig: ITerraformConfig[]

  beforeEach(() => {
    jest.clearAllMocks()
    mockConfig = [
      { id: 'stack-1', depends_on: [], input: [] },
      { id: 'stack-2', depends_on: [], input: [] }
    ]
  })

  it('should add implicit dependency when referencing another stack variable', () => {
    const result = update_deploy_config(
      mockConfig,
      0,
      'key',
      'stack.stack-2.var.someVar'
    )
    expect(result.depends_on).toContain('stack-2')
  })

  it('should throw error if split length is not 4', () => {
    expect(() =>
      update_deploy_config(mockConfig, 0, 'key', 'stack.stack-2.var')
    ).toThrow('Invalid split length (3) for value: stack.stack-2.var')
  })

  it("should throw error if type is not 'var' or 'secret'", () => {
    expect(() =>
      update_deploy_config(
        mockConfig,
        0,
        'key',
        'stack.stack-2.invalid.someVar'
      )
    ).toThrow(
      "Type must be 'var' or 'secret' for stack.stack-2.invalid.someVar"
    )
  })

  it('should warn if referenced stack does not exist', () => {
    const result = update_deploy_config(
      mockConfig,
      0,
      'key',
      'stack.nonexistent.var.someVar'
    )
    expect(core.warning).toHaveBeenCalledWith(
      'Stack nonexistent not found in config'
    )
    // Should NOT add the dependency since the stack doesn't exist in current config
    // (cross-config references are resolved from GitHub secrets/KeyVault at runtime)
    expect(result.depends_on).not.toContain('nonexistent')
  })

  it('should handle cross-config references (stack not in config but values from GitHub secrets/KeyVault)', () => {
    // This simulates the use case where:
    // - Stack 'aks' is deployed in a different layer/config
    // - Its outputs are stored in GitHub secrets/KeyVault
    // - Current stack references those values
    const configWithCrossRef: ITerraformConfig[] = [
      {
        id: 'ocs-ci-service-namespaces',
        depends_on: [],
        input: [
          { cluster_host: 'stack.aks.secret.cluster_host' },
          { cluster_ca_certificate: 'stack.aks.secret.cluster_ca_certificate' },
          { client_key: 'stack.aks.secret.client_key' },
          { client_certificate: 'stack.aks.secret.client_certificate' }
        ]
      }
    ]

    // Process all inputs
    for (const [key, value] of Object.entries(
      configWithCrossRef[0].input || {}
    )) {
      configWithCrossRef[0] = update_deploy_config(
        configWithCrossRef,
        0,
        key,
        value
      )
    }

    // Should have warned 4 times (once per secret reference)
    expect(core.warning).toHaveBeenCalledTimes(4)
    expect(core.warning).toHaveBeenCalledWith('Stack aks not found in config')

    // Should not have added 'aks' as dependency
    expect(configWithCrossRef[0].depends_on).not.toContain('aks')

    // Original input should still be preserved (the stack.aks.secret.* references)
    // These will be resolved from GitHub secrets/KeyVault at runtime
    expect(configWithCrossRef[0].input).toHaveLength(4)
    expect(configWithCrossRef[0].input).toEqual([
      { cluster_host: 'stack.aks.secret.cluster_host' },
      { cluster_ca_certificate: 'stack.aks.secret.cluster_ca_certificate' },
      { client_key: 'stack.aks.secret.client_key' },
      { client_certificate: 'stack.aks.secret.client_certificate' }
    ])
  })

  it('should correctly handle array inputs', () => {
    const result = update_deploy_config(mockConfig, 0, 'key', [
      'stack.stack-2.var.someVar',
      'stack.stack-2.var.anotherVar'
    ])
    expect(result.depends_on).toContain('stack-2')
  })

  it('should correctly handle nested object inputs', () => {
    const result = update_deploy_config(mockConfig, 0, 'key', {
      nestedKey: 'stack.stack-2.var.someVar'
    })
    expect(result.depends_on).toContain('stack-2')
  })

  it('should correctly handle multi-nested object inputs', () => {
    const result = update_deploy_config(mockConfig, 0, 'key', {
      nestedKey: { superNestedKey: 'stack.stack-2.var.someVar' }
    })
    expect(result.depends_on).toContain('stack-2')
  })
})

describe('convert_implicit_to_explicit_dependencies', () => {
  let mockConfig: ITerraformConfig[]

  beforeEach(() => {
    mockConfig = [
      {
        id: 'stack-1',
        depends_on: [],
        input: ['stack.stack-2.var.someVar', 'stack.stack-2.var.other_var[0]']
      },
      { id: 'stack-2', depends_on: [], input: [] },
      { id: 'stack-3', depends_on: ['stack-1'], input: [] }
    ]
  })

  it('should convert implicit dependencies to explicit dependencies', () => {
    const result = convert_implicit_to_explicit_dependencies(mockConfig)
    expect(result[0].depends_on).toContain('stack-2')
  })

  it('should be able to use implicit and explicit dependencies in conjunction', () => {
    const result = convert_implicit_to_explicit_dependencies(mockConfig)
    const stack_1_index = result.findIndex((stack) => stack.id === 'stack-1')
    const stack_2_index = result.findIndex((stack) => stack.id === 'stack-2')
    const stack_3_index = result.findIndex((stack) => stack.id === 'stack-3')
    expect(result[stack_1_index].depends_on).toContain('stack-2')
    expect(result[stack_3_index].depends_on).toContain('stack-1')
    expect(result[stack_2_index].depends_on).toStrictEqual([])
  })

  it('should return the baseKey as variable name', () => {
    const result = convert_implicit_to_explicit_dependencies(mockConfig)
    const stack_2_index = result.findIndex((stack) => stack.id === 'stack-2')

    expect(result[stack_2_index]['output-var']).toStrictEqual([
      'someVar',
      'other_var'
    ])
  })

  it('should handle multiple implicit dependencies', () => {
    mockConfig[0].input = [
      { key1: 'stack.stack-2.var.someVar' },
      { key2: 'stack.stack-2.secret.someSecret' }
    ]
    const result = convert_implicit_to_explicit_dependencies(mockConfig)
    expect(result[0].depends_on).toContain('stack-2')
  })

  it('should not modify stacks with no implicit dependencies', () => {
    const result = convert_implicit_to_explicit_dependencies([
      { id: 'stack-1', depends_on: [], input: [] }
    ])
    expect(result[0].depends_on).toEqual([])
  })

  it('should throw an error for invalid input references', () => {
    mockConfig[0].input = [{ key: 'stack.stack-2.invalid.someVar' }]
    expect(() => convert_implicit_to_explicit_dependencies(mockConfig)).toThrow(
      "Type must be 'var' or 'secret' for stack.stack-2.invalid.someVar"
    )
  })
})

describe('apply_stack_filter', () => {
  let mockConfig: ITerraformConfig[]

  beforeEach(() => {
    mockConfig = [
      { id: 'stack-1', depends_on: ['stack-2'], input: [] },
      { id: 'stack-2', depends_on: [], input: [] },
      {
        id: 'random-string',
        name: 'Random String',
        type: 'terraform',
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'dns',
        name: 'DNS',
        type: 'terraform',
        input: [
          { enablePrivateDnsInternal: true },
          { enablePrivateDnsStorageAccount: false },
          { enablePrivateDnsPsqlflex: true },
          { geocode: 'ne' }
        ],
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'traffic-manager',
        name: 'Traffic Manager',
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'vnet',
        name: 'vnet',
        type: 'terraform',
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'aks',
        name: 'Aks Cluster',
        type: 'terraform',
        input: [
          'stack.vnet.var.subnet_name_aks',
          { vnet_name: 'stack.vnet.var.vnet_name' },
          {
            listElements: [
              'stack.vnet.var.subnet_name_databases',
              'stack.vnet.var.subnet_name_aks'
            ]
          },
          { objectElements: { name: 'stack.vnet.var.vnet_name' } }
        ],
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'istio-namespace',
        name: 'Istio Namespace',
        type: 'terraform',
        folder: 'k8s-namespace',
        input: [
          { namespace_name: 'istio-system' },
          'stack.aks.secret.cluster_host',
          'stack.aks.secret.cluster_ca_certificate',
          'stack.aks.secret.client_key',
          'stack.aks.secret.client_certificate'
        ],
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'argo-namespace',
        name: 'ArgoCD Namespace',
        type: 'terraform',
        input: [
          { namespace_name: 'argocd' },
          'stack.aks.secret.cluster_host',
          'stack.aks.secret.cluster_ca_certificate',
          'stack.aks.secret.client_key',
          'stack.aks.secret.client_certificate'
        ],
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'tools-namespace',
        name: 'Tools Namespace',
        type: 'terraform',
        input: [
          { namespace_name: 'tools' },
          'stack.aks.secret.cluster_host',
          'stack.aks.secret.cluster_ca_certificate',
          'stack.aks.secret.client_key',
          'stack.aks.secret.client_certificate'
        ],
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'external-dns-namespace',
        name: 'External DNS Namespace',
        type: 'terraform',
        input: [
          { namespace_name: 'externaldns' },
          'stack.aks.secret.cluster_host',
          'stack.aks.secret.cluster_ca_certificate',
          'stack.aks.secret.client_key',
          'stack.aks.secret.client_certificate'
        ],
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'azure-rbac',
        name: 'Azure RBAC',
        type: 'terraform',
        input: ['stack.aks.var.aks_kubelet_identity_object_id'],
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'external-dns',
        name: 'External DNS',
        type: 'terraform',
        input: [
          'stack.aks.secret.cluster_host',
          'stack.aks.secret.cluster_ca_certificate',
          'stack.aks.secret.client_key',
          'stack.aks.secret.client_certificate',
          'stack.external-dns-namespace.var.namespace_name',
          'stack.aks.var.aks_cluster_name',
          'stack.aks.var.aks_kubelet_identity_client_id',
          { cluster_sp_tenant_id: 'gh.var.ARM_TENANT_ID' },
          { cluster_sp_subscription_id: 'gh.var.ARM_SUBSCRIPTION_ID' }
        ],
        depends_on: ['azure-rbac'],
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'istio-1-24-2',
        name: 'Istio v1.24.2',
        type: 'terraform',
        'stack-groups': ['group-istio'],
        input: [
          'stack.istio-namespace.var.namespace_name',
          'stack.aks.secret.cluster_host',
          'stack.aks.secret.cluster_ca_certificate',
          'stack.aks.secret.client_key',
          'stack.aks.secret.client_certificate'
        ],
        depends_on: ['aks'],
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'istio-gateway-main',
        name: 'Istio Gateway main',
        type: 'terraform',
        'stack-groups': ['group-istio'],
        input: [
          'stack.istio-namespace.var.namespace_name',
          'stack.aks.secret.cluster_host',
          'stack.aks.secret.cluster_ca_certificate',
          'stack.aks.secret.client_key',
          'stack.aks.secret.client_certificate',
          { gateway_selector: 'istio-gateway-selector' },
          { gateway_name: 'istio-gateway' }
        ],
        depends_on: ['istio-1-24-2', 'aks'],
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'log-analytics',
        name: 'Log Analytics',
        type: 'terraform',
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'vpn-gateway',
        name: 'VPN Gateway',
        type: 'terraform',
        input: ['stack.vnet.var.subnet_id_gateway'],
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'private-dns-resolver',
        name: 'Private DNS Resolver',
        type: 'terraform',
        input: [
          'stack.vnet.var.vpn_vnet_id',
          {
            endpoint_inbound_subnets: [
              {
                name: 'stack.vnet.var.subnet_name_inbound',
                id: 'stack.vnet.var.subnet_id_inbound'
              }
            ]
          }
        ],
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'network-security-group',
        name: 'Network Security Group',
        type: 'terraform',
        input: [{ subnet_ids: ['stack.vnet.var.subnet_id_inbound'] }],
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'network-watcher-logs',
        name: 'Network Watcher Logs',
        type: 'terraform',
        input: [
          'stack.network-security-group.var.network_security_group_id',
          'stack.log-analytics.var.log_analytics_workspace_name'
        ],
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'main-vnet-to-vpn-vnet-peering',
        name: 'Main VNET to VPN VNET Peering',
        type: 'terraform',
        input: [
          {
            peering_config_from: {
              virtual_network_name: 'stack.vnet.var.vnet_name',
              remote_virtual_network_id: 'stack.vnet.var.vpn_vnet_id',
              allow_forwarded_traffic: true,
              allow_gateway_transit: true,
              use_remote_gateways: true
            }
          },
          {
            peering_config_to: {
              virtual_network_name: 'stack.vnet.var.vpn_vnet_name',
              remote_virtual_network_id: 'stack.vnet.var.vnet_id',
              allow_forwarded_traffic: true,
              allow_gateway_transit: false,
              use_remote_gateways: false
            }
          }
        ],
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'ocs-ci-namespace',
        name: 'ocs-ci Namespace',
        type: 'terraform',
        input: [
          { 'namespace-name': 'ocs-ci' },
          {
            namespace_annotations: {
              'instrumentation.opentelemetry.io/inject-java':
                'observability/ocs-instrumentation',
              'instrumentation.opentelemetry.io/container-names': 'ocs-ci'
            }
          },
          'stack.aks.secret.cluster_host',
          'stack.aks.secret.cluster_ca_certificate',
          'stack.aks.secret.client_key',
          'stack.aks.secret.client_certificate'
        ],
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'ocs-dev-namespace',
        name: 'ocs-dev Namespace',
        type: 'terraform',
        folder: 'k8s-namespace',
        input: [
          { 'namespace-name': 'ocs-dev' },
          'stack.aks.secret.cluster_host',
          'stack.aks.secret.cluster_ca_certificate',
          'stack.aks.secret.client_key',
          'stack.aks.secret.client_certificate'
        ],
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'solution-ocs-dev-infra-eventhub-master-data',
        name: 'Ocs-dev Eventhub Master-data',
        folder: 'eventhub',
        type: 'terraform',
        'stack-groups': [
          'eventhubs',
          'ocs-dev-eventhubs',
          'ocs-dev-all',
          'ocs-dev-infra'
        ],
        input: [
          { namespace_id: 'master-data' },
          { topics: ['abc', 'bcd', 'cde'] }
        ],
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'solution-ocs-dev-infra-database-psqlflex',
        name: 'Ocs-dev Postgresql Flex',
        folder: 'database-psql-flex',
        'stack-groups': ['databases', 'ocs-dev-all', 'ocs-dev-infra'],
        type: 'terraform',
        input: ['stack.random-string.var.random_string'],
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'solution-ocs-dev-aks-database-psqlflex-secret',
        name: 'Ocs-dev Postgresql Flex Secret',
        folder: 'k8s-secret-data',
        type: 'terraform',
        input: [
          'stack.random-string.var.random_string',
          'stack.ocs-dev-namespace.var.namespace_name',
          { secret_name: 'database-psqlflex-secret' },
          {
            data: {
              fqdn: 'stack.solution-ocs-dev-infra-database-psqlflex.var.fqdn',
              username:
                'stack.solution-ocs-dev-infra-database-psqlflex.var.username',
              password:
                'stack.solution-ocs-dev-infra-database-psqlflex.secret.password'
            }
          },
          'stack.aks.secret.cluster_host',
          'stack.aks.secret.cluster_ca_certificate',
          'stack.aks.secret.client_key',
          'stack.aks.secret.client_certificate'
        ],
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'solution-ocs-dev-aks-eventhub-master-data-secret',
        name: 'Ocs-dev Eventhub Masterdata Secret',
        folder: 'k8s-secret-data',
        type: 'terraform',
        input: [
          'stack.random-string.var.random_string',
          'stack.ocs-dev-namespace.var.namespace_name',
          { secret_name: 'eventhub-secret-master-data' },
          {
            data: {
              event_hub_namespace:
                'stack.solution-ocs-dev-infra-eventhub-master-data.var.namespace',
              bootstrap_servers:
                'stack.solution-ocs-dev-infra-eventhub-master-data.var.bootstrap_servers'
            }
          },
          'stack.aks.secret.cluster_host',
          'stack.aks.secret.cluster_ca_certificate',
          'stack.aks.secret.client_key',
          'stack.aks.secret.client_certificate'
        ],
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      },
      {
        id: 'solution-ocs-dev-aks-solution-secrets',
        name: 'Ocs-dev Solution Secrets',
        type: 'terraform',
        folder: 'k8s-secret-data',
        input: [
          { secret_name: 'solution-secrets' },
          { namespace_name: 'ocs-dev' },
          { data: { todokeys: 'todovalue' } },
          'stack.aks.secret.cluster_host',
          'stack.aks.secret.cluster_ca_certificate',
          'stack.aks.secret.client_key',
          'stack.aks.secret.client_certificate'
        ],
        globals: {
          subdomains: ['ocs-dev', 'ocs-ci', 'argocd', 'pgadmin', 'grafana'],
          customer_id: 'example',
          stage: 'dev',
          resource_group_name: 'rg-example-dev',
          'dry-run': 'true',
          'state-storage-account-name': 'stexampledevtfstate',
          'state-resource-group-name': 'rg-example-dev',
          project: 'example',
          environment: 'dev.example.com',
          dns_zone_name: 'dev.example.com',
          dns_zone_resource_group_name: 'rg-example-dns-dev',
          public_cloud_flag: 'true',
          release_tag_name: 'sha-e05fcb45c2c41003195c10b9db5e89fc11574b7e',
          has_release_tag: 'false'
        }
      }
    ]
  })

  it('should filter dependencies based on expanded stack filter', () => {
    const result = apply_stack_filter(mockConfig, ['stack-2'])
    expect(result.length).toEqual(1)
    expect(result[0].id).toEqual('stack-2')
  })
  it('should remove dependencies not in expanded stack filter', () => {
    const result = apply_stack_filter(mockConfig, ['stack-1'])
    expect(result.length).toEqual(1)
    expect(result[0].depends_on).toEqual([])
  })

  it('replaces an omitted dependency with its selected ancestor for layering', () => {
    const config: ITerraformConfig[] = [
      { id: 'vnet', depends_on: [], input: [] },
      { id: 'aks', depends_on: ['vnet'], input: [] },
      { id: 'secret', depends_on: ['aks'], input: [] }
    ]

    const filtered = apply_stack_filter(config, ['vnet', 'secret'])
    const layer0 = generate_layerdeployment(filtered, 0, {}, [])
    const layer1 = generate_layerdeployment(filtered, 1, {}, [layer0])

    expect(filtered.find((stack) => stack.id === 'secret')?.depends_on).toEqual(
      ['vnet']
    )
    expect(layer0.map((stack) => stack.id)).toEqual(['vnet'])
    expect(layer1.map((stack) => stack.id)).toEqual(['secret'])
  })

  it('preserves a selected root dependency across a 10,000-stack omitted intermediary chain', () => {
    const stackCount = 10_000
    const config: ITerraformConfig[] = Array.from(
      { length: stackCount },
      (_, index) => ({
        id: `stack-${index}`,
        depends_on: index === 0 ? [] : [`stack-${index - 1}`],
        input: []
      })
    )
    let filtered: ITerraformConfig[] = []

    expect(() => {
      filtered = apply_stack_filter(config, [
        'stack-0',
        `stack-${stackCount - 1}`
      ])
    }).not.toThrow()

    expect(
      filtered.find((stack) => stack.id === `stack-${stackCount - 1}`)
        ?.depends_on
    ).toEqual(['stack-0'])
  })

  it('handles a 10,000-stack omitted cycle without losing a selected root dependency', () => {
    const stackCount = 10_000
    const cycleTarget = 5_000
    const config: ITerraformConfig[] = Array.from(
      { length: stackCount },
      (_, index) => ({
        id: `stack-${index}`,
        depends_on:
          index === 0
            ? []
            : index === 1
              ? ['stack-0', `stack-${cycleTarget}`]
              : [`stack-${index - 1}`],
        input: []
      })
    )
    let filtered: ITerraformConfig[] = []

    expect(() => {
      filtered = apply_stack_filter(config, [
        'stack-0',
        `stack-${stackCount - 1}`
      ])
    }).not.toThrow()

    expect(
      filtered.find((stack) => stack.id === `stack-${stackCount - 1}`)
        ?.depends_on
    ).toEqual(['stack-0'])
  })

  it('resolves multiple omitted paths in declaration order without duplicate endpoints', () => {
    const config: ITerraformConfig[] = [
      { id: 'vnet', depends_on: [], input: [] },
      { id: 'database', depends_on: [], input: [] },
      { id: 'aks', depends_on: ['vnet'], input: [] },
      { id: 'sql', depends_on: ['database', 'vnet'], input: [] },
      { id: 'secret', depends_on: ['aks', 'sql', 'aks'], input: [] }
    ]

    const filtered = apply_stack_filter(config, ['vnet', 'database', 'secret'])

    expect(filtered.find((stack) => stack.id === 'secret')?.depends_on).toEqual(
      ['vnet', 'database']
    )
    expect(config.find((stack) => stack.id === 'secret')?.depends_on).toEqual([
      'aks',
      'sql',
      'aks'
    ])
  })

  it('ignores missing, cyclic, and self dependencies', () => {
    const config: ITerraformConfig[] = [
      { id: 'cycle-a', depends_on: ['cycle-b'], input: [] },
      { id: 'cycle-b', depends_on: ['cycle-a'], input: [] },
      { id: 'secret', depends_on: ['cycle-a', 'missing', 'secret'], input: [] }
    ]

    const filtered = apply_stack_filter(config, ['secret', 'missing'])

    expect(filtered).toEqual([{ id: 'secret', depends_on: [], input: [] }])
  })

  it('should return the correct length of filtered stacks', () => {
    const result = apply_stack_filter(mockConfig, [
      'istio-1-24-2',
      'istio-gateway-main'
    ])
    core.info(JSON.stringify(result))
    expect(result.length).toEqual(2)
  })
})

describe('prune_external_dependencies', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('removes explicit dependencies on stacks not present in the config', () => {
    const config = [
      { id: 'stack-1', depends_on: [], input: [] },
      { id: 'stack-2', depends_on: ['external-stack', 'stack-1'], input: [] }
    ]
    const result = prune_external_dependencies(config)
    expect(result[1].depends_on).toEqual(['stack-1'])
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('external-stack')
    )
  })

  it('keeps dependencies that reference stacks present in the config', () => {
    const config = [
      { id: 'stack-1', depends_on: [], input: [] },
      { id: 'stack-2', depends_on: ['stack-1'], input: [] }
    ]
    const result = prune_external_dependencies(config)
    expect(result[1].depends_on).toEqual(['stack-1'])
    expect(core.warning).not.toHaveBeenCalled()
  })

  it('handles stacks without a depends_on property', () => {
    const config = [{ id: 'stack-1', input: [] }]
    const result = prune_external_dependencies(config)
    expect(result[0].depends_on).toEqual([])
  })

  it('keeps a stack schedulable when its only extra dep is external', () => {
    const config = [
      { id: 'stack-1', depends_on: [], input: [] },
      {
        id: 'stack-2',
        depends_on: ['external-namespaces', 'stack-1'],
        input: []
      }
    ]
    const pruned = prune_external_dependencies(config)
    const layers: ReturnType<typeof generate_layerdeployment>[] = []
    for (let i = 0; i < 5; i++) {
      layers.push(generate_layerdeployment(pruned, i, {}, layers))
    }
    const scheduled = layers.flat().map((c) => c.id)
    expect(scheduled).toContain('stack-1')
    expect(scheduled).toContain('stack-2')
  })
  it('emits exactly one warning per pruned external dep (US-2)', () => {
    const config = [
      {
        id: 'stack-a',
        depends_on: ['ext-x', 'ext-y'],
        input: [] as ITerraformConfig['input']
      }
    ]
    prune_external_dependencies(config)
    expect(core.warning).toHaveBeenCalledTimes(2)
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('ext-x'))
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('ext-y'))
  })

  it('stack with only external deps is placed in layer 0 after pruning (US-4)', () => {
    const config = [
      {
        id: 'stack-a',
        depends_on: ['ext-1', 'ext-2'],
        input: [] as ITerraformConfig['input']
      }
    ]
    const pruned = prune_external_dependencies(config)
    const layer0 = generate_layerdeployment(pruned, 0, {}, [])
    expect(layer0.map((c) => c.id)).toContain('stack-a')
    expect(layer0[0].layer).toBe(0)
  })

  it('pruning one stack leaves sibling stacks depends_on unchanged (US-7)', () => {
    const config = [
      { id: 'stack-1', depends_on: [], input: [] as ITerraformConfig['input'] },
      {
        id: 'stack-2',
        depends_on: ['stack-1'],
        input: [] as ITerraformConfig['input']
      },
      {
        id: 'stack-3',
        depends_on: ['ext-dep', 'stack-1'],
        input: [] as ITerraformConfig['input']
      }
    ]
    const result = prune_external_dependencies(config)
    expect(result[0].depends_on).toEqual([])
    expect(result[1].depends_on).toEqual(['stack-1'])
    expect(result[2].depends_on).toEqual(['stack-1'])
  })

  it('multiple stacks with different external deps are all pruned and all scheduled (US-8)', () => {
    const config = [
      {
        id: 'stack-a',
        depends_on: ['ext-1'],
        input: [] as ITerraformConfig['input']
      },
      {
        id: 'stack-b',
        depends_on: ['ext-2'],
        input: [] as ITerraformConfig['input']
      },
      {
        id: 'stack-c',
        depends_on: ['ext-3', 'stack-a'],
        input: [] as ITerraformConfig['input']
      }
    ]
    const pruned = prune_external_dependencies(config)
    expect(core.warning).toHaveBeenCalledTimes(3)
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('ext-1'))
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('ext-2'))
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('ext-3'))
    const layers: ITerraformLayerConfig[][] = []
    for (let i = 0; i < 5; i++) {
      layers.push(generate_layerdeployment(pruned, i, {}, layers))
    }
    const scheduled = layers.flat().map((c) => c.id)
    expect(scheduled).toContain('stack-a')
    expect(scheduled).toContain('stack-b')
    expect(scheduled).toContain('stack-c')
  })

  it('implicit cross-config ref and explicit external dep both warn and neither blocks scheduling (US-9)', () => {
    const config: ITerraformConfig[] = [
      { id: 'stack-a', depends_on: [], input: [] },
      {
        id: 'stack-b',
        depends_on: [],
        input: ['stack.ext-stack.var.some_output']
      },
      { id: 'stack-c', depends_on: ['ext-other'], input: [] }
    ]
    const converted = convert_implicit_to_explicit_dependencies(config)
    expect(core.warning).toHaveBeenCalledWith(
      'Stack ext-stack not found in config'
    )
    const stackB = converted.find((s) => s.id === 'stack-b')!
    expect(stackB.depends_on).not.toContain('ext-stack')

    const pruned = prune_external_dependencies(converted)
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('ext-other')
    )
    const stackC = pruned.find((s) => s.id === 'stack-c')!
    expect(stackC.depends_on).not.toContain('ext-other')

    const layers: ITerraformLayerConfig[][] = []
    for (let i = 0; i < 5; i++) {
      layers.push(generate_layerdeployment(pruned, i, {}, layers))
    }
    const scheduled = layers.flat().map((c) => c.id)
    expect(scheduled).toContain('stack-a')
    expect(scheduled).toContain('stack-b')
    expect(scheduled).toContain('stack-c')
  })

  it('no stack is dropped from the plan regardless of how many external deps exist (US-10)', () => {
    const config = [
      { id: 'infra', depends_on: [], input: [] as ITerraformConfig['input'] },
      {
        id: 'platform',
        depends_on: ['ext-bootstrap'],
        input: [] as ITerraformConfig['input']
      },
      {
        id: 'app-a',
        depends_on: ['infra', 'ext-shared'],
        input: [] as ITerraformConfig['input']
      },
      {
        id: 'app-b',
        depends_on: ['app-a'],
        input: [] as ITerraformConfig['input']
      },
      {
        id: 'app-c',
        depends_on: ['ext-only'],
        input: [] as ITerraformConfig['input']
      }
    ]
    const pruned = prune_external_dependencies(config)
    const layers: ITerraformLayerConfig[][] = []
    for (let i = 0; i < 10; i++) {
      layers.push(generate_layerdeployment(pruned, i, {}, layers))
    }
    const scheduled = layers.flat().map((c) => c.id)
    expect(scheduled).toContain('infra')
    expect(scheduled).toContain('platform')
    expect(scheduled).toContain('app-a')
    expect(scheduled).toContain('app-b')
    expect(scheduled).toContain('app-c')
    expect(new Set(scheduled).size).toBe(scheduled.length)
  })
})
