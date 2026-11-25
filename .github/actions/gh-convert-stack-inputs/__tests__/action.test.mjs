import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const bundle = fileURLToPath(new URL('../dist/index.js', import.meta.url))
const inputs = [
  { greeting: 'hello' },
  { replicas: 2 },
  { settings: { enabled: true } }
]
const expected = [
  { key: 'greeting', value: 'hello' },
  { key: 'replicas', value: 2 },
  { key: 'settings', value: { enabled: true } }
]

function sandbox(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'stax-convert-action-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const runnerTemp = path.join(root, 'runner-temp')
  const output = path.join(root, 'github-output')
  // The runner temp directory is intentionally distinct from the output file.
  mkdirSync(runnerTemp)
  return (input = {}, options = {}) => {
    writeFileSync(output, '')
    const env = { ...process.env }
    for (const key of Object.keys(env)) {
      if (key.startsWith('INPUT_')) delete env[key]
    }
    Object.assign(env, {
      GITHUB_OUTPUT: output,
      RUNNER_TEMP: runnerTemp,
      INPUT_CONVERTINPUTS: JSON.stringify(inputs),
      ...input
    })
    if (options.noRunnerTemp) delete env.RUNNER_TEMP
    const result = spawnSync(process.execPath, [bundle], {
      env,
      cwd: root,
      encoding: 'utf8'
    })
    assert.ifError(result.error)
    const outputText = readFileSync(output, 'utf8')
    const outputs = Object.fromEntries(
      [
        ...outputText.matchAll(/^([\w-]+)<<([^\r\n]+)\r?\n(.*?)\r?\n\2\r?$/gm)
      ].map(([, name, , value]) => [name, value])
    )
    return { ...result, outputText, outputs, runnerTemp }
  }
}

test('bundled action preserves step-output JSON on Linux and Windows', (t) => {
  const result = sandbox(t)()
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(Object.keys(result.outputs), ['tf-vars-map'])
  assert.deepEqual(JSON.parse(result.outputs['tf-vars-map']), expected)
})

test(
  'bundled action writes private inputs below RUNNER_TEMP on Linux',
  { skip: process.platform === 'win32' },
  (t) => {
    const result = sandbox(t)({ 'INPUT_OUTPUT-MODE': 'private-file' })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(Object.keys(result.outputs), ['resolved-inputs-file'])
    const file = result.outputs['resolved-inputs-file']
    const directory = path.dirname(file)
    assert.equal(path.dirname(directory), result.runnerTemp)
    assert.match(path.basename(directory), /^resolved-stack-inputs-/)
    assert.equal(statSync(directory).mode & 0o777, 0o700)
    assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
      greeting: 'hello',
      replicas: 2,
      settings: { enabled: true }
    })
    assert.doesNotMatch(result.outputText, /hello|replicas|settings/)
  }
)

test(
  'bundled action rejects absent RUNNER_TEMP before resolving inputs on Linux',
  { skip: process.platform === 'win32' },
  (t) => {
    const result = sandbox(t)(
      {
        'INPUT_OUTPUT-MODE': 'private-file',
        INPUT_CONVERTINPUTS: JSON.stringify([
          { token: 'secret_backend.secret.missing' }
        ])
      },
      { noRunnerTemp: true }
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stdout, /RUNNER_TEMP/)
    assert.equal(result.outputText, '')
  }
)

test(
  'bundled action rejects private-file on native Windows before resolving inputs',
  { skip: process.platform !== 'win32' },
  (t) => {
    const result = sandbox(t)({
      'INPUT_OUTPUT-MODE': 'private-file',
      INPUT_CONVERTINPUTS: JSON.stringify([
        { token: 'secret_backend.secret.missing' }
      ])
    })
    assert.notEqual(result.status, 0)
    assert.match(
      result.stdout,
      /output-mode private-file is supported only on Linux and macOS/
    )
    assert.equal(result.outputText, '')
  }
)
