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

  it('forwards nested stack jobs with secrets: inherit (not explicit remapping)', () => {
    // Explicit remapping on levels→stack re-expands ${{ secrets.* }} on a
    // uses: job that has no environment:, so Environment-scoped values arrive
    // empty further down. Same-repo inherit preserves the named pass from the
    // cross-org caller; leaf jobs with environment: then resolve them.
    const inheritCount = [
      ...deployLevelsWorkflow.matchAll(/^ {4}secrets: inherit$/gm)
    ].length
    expect(inheritCount).toBe(14)
    expect(deployLevelsWorkflow).not.toMatch(
      /^ {4}HCLOUD_TOKEN: \$\{\{ secrets\.HCLOUD_TOKEN \}\}$/m
    )
    expect(deployLevelsWorkflow).toMatch(
      /^ {6}HCLOUD_TOKEN:\n {8}required: false$/m
    )
  })

  it('declares HCLOUD_TOKEN on packer and terraform so gh.secret.hcloud_token can resolve', () => {
    expect(deployStackWorkflow).toMatch(
      /^ {6}HCLOUD_TOKEN:\n {8}required: false$/m
    )
    expect(packerWorkflow).toMatch(/^ {6}HCLOUD_TOKEN:\n {8}required: false$/m)
    expect(terraformWorkflow).toMatch(
      /^ {6}HCLOUD_TOKEN:\n {8}required: false$/m
    )
  })
})
