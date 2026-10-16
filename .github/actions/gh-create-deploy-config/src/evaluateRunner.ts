// Ich hätte es anders genannt, aber naja...
import * as core from '@actions/core'

export function evaluateRunner(runner: string | undefined): string {
  runner = runner?.replace(/\./g, '-')
  core.info(`Evaluated runner: ${runner}`)
  return runner || ''
}
