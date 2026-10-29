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

  it('declares optional workflow_call secrets including HCLOUD_TOKEN on levels', () => {
    // Cross-org callers map these by name into deploy-levels; inherit stops at orgs.
    expect(deployLevelsWorkflow).toMatch(
      /^ {6}HCLOUD_TOKEN:\n {8}required: false$/m
    )
    expect(deployLevelsWorkflow).toMatch(
      /^ {6}ARM_CLIENT_ID:\n {8}required: false$/m
    )
  })

  it('uses secrets: inherit on all 14 nested level jobs', () => {
    const inheritCount = [
      ...deployLevelsWorkflow.matchAll(/^ {4}secrets: inherit$/gm)
    ].length
    expect(inheritCount).toBe(14)
    expect(deployLevelsWorkflow).not.toMatch(
      /^ {6}HCLOUD_TOKEN: \$\{\{ secrets\.HCLOUD_TOKEN \}\}$/m
    )
  })

  it('uses secrets: inherit on stack child jobs (packer/terraform/script/sites)', () => {
    const inheritCount = [
      ...deployStackWorkflow.matchAll(/^ {4}secrets: inherit$/gm)
    ].length
    expect(inheritCount).toBe(6)
    expect(deployStackWorkflow).not.toMatch(
      /^ {6}HCLOUD_TOKEN: \$\{\{ secrets\.HCLOUD_TOKEN \}\}$/m
    )
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
