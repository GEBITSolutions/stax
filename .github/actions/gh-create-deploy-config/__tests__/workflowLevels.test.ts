import { readFileSync } from 'fs'

describe('deployment level workflow capacity', () => {
  const deployLevelsWorkflow = readFileSync(
    '../../workflows/a-wf-deploy-levels.yml',
    'utf8'
  )
  const setupWorkflow = readFileSync(
    '../../workflows/a-wf-setup-ci.yml',
    'utf8'
  )
  const actionMetadata = readFileSync('action.yml', 'utf8')
  const deployStackWorkflow = readFileSync(
    '../../workflows/a-wf-deploy-stack.yml',
    'utf8'
  )
  const terraformWorkflow = readFileSync(
    '../../workflows/a-wf-deploy-stack-terraform.yml',
    'utf8'
  )
  const packerWorkflow = readFileSync(
    '../../workflows/a-wf-deploy-stack-packer.yml',
    'utf8'
  )

  it('defines aligned jobs for levels 0 through 13', () => {
    const jobLevels = [...deployLevelsWorkflow.matchAll(/^ {2}l(\d+):$/gm)].map(
      (match) => Number(match[1])
    )

    expect(jobLevels).toEqual(Array.from({ length: 14 }, (_, index) => index))
    for (let level = 1; level < 14; level++) {
      expect(deployLevelsWorkflow).toContain(
        `if: fromJson(inputs.ci_config)[${level}][0] != null`
      )
      expect(deployLevelsWorkflow).toContain(
        `data: \${{ fromJson(inputs.ci_config)[${level}] }}`
      )
    }
  })

  it('uses 14 as the action and setup workflow depth', () => {
    expect(actionMetadata).toMatch(
      /deploy-depth:\n\s+description:.*\n\s+required: false\n\s+default: '14'/
    )
    expect(setupWorkflow).toContain('deploy-depth: "14"')
  })

  it('never uses secrets: inherit in deploy levels or stack workflows', () => {
    // Cross-org callers cannot rely on inherit; every hop must map secrets by
    // name. Leaf jobs that need Environment-scoped values set environment:.
    expect(deployLevelsWorkflow).not.toMatch(/^ {4}secrets: inherit$/m)
    expect(deployStackWorkflow).not.toMatch(/^ {4}secrets: inherit$/m)
  })

  it('forwards HCLOUD_TOKEN by name on every level job into stack', () => {
    const hcloudMaps = [
      ...deployLevelsWorkflow.matchAll(
        /^ {6}HCLOUD_TOKEN: \$\{\{ secrets\.HCLOUD_TOKEN \}\}$/gm
      )
    ].length
    expect(hcloudMaps).toBe(14)
    expect(deployLevelsWorkflow).toMatch(
      /^ {6}HCLOUD_TOKEN:\n {8}required: false$/m
    )
  })

  it('forwards HCLOUD_TOKEN by name from stack into packer and terraform', () => {
    const hcloudMaps = [
      ...deployStackWorkflow.matchAll(
        /^ {6}HCLOUD_TOKEN: \$\{\{ secrets\.HCLOUD_TOKEN \}\}$/gm
      )
    ].length
    // Packer + terraform jobs each map HCLOUD_TOKEN.
    expect(hcloudMaps).toBe(2)
  })

  it('declares HCLOUD_TOKEN on stack, packer and terraform for gh.secret.hcloud_token', () => {
    expect(deployStackWorkflow).toMatch(
      /^ {6}HCLOUD_TOKEN:\n {8}required: false$/m
    )
    expect(packerWorkflow).toMatch(/^ {6}HCLOUD_TOKEN:\n {8}required: false$/m)
    expect(terraformWorkflow).toMatch(
      /^ {6}HCLOUD_TOKEN:\n {8}required: false$/m
    )
  })
})
