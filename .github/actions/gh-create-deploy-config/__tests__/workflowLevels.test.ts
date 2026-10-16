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
})
