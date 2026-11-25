import { jest } from '@jest/globals'
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as core from '../__fixtures__/core.js'

jest.unstable_mockModule('@actions/core', () => core)
const { createKeyValue: originalCreateKeyValue } =
  await import('../src/converter.js')
const createKeyValue = jest.fn(originalCreateKeyValue)
jest.unstable_mockModule('../src/converter.js', () => ({ createKeyValue }))

const { run } = await import('../src/index.js')

describe('index.ts', () => {
  // Runners always set GITHUB_WORKSPACE, which run() prefers over cwd.
  const originalWorkspace = process.env.GITHUB_WORKSPACE

  beforeEach(() => {
    delete process.env.GITHUB_WORKSPACE
    jest.resetAllMocks()
    core.getInput.mockImplementation(() => '') // Default mock: empty input
    createKeyValue.mockImplementation(async () => ({
      key: 'test_key',
      value: 'test_value'
    }))
  })

  afterEach(() => {
    if (originalWorkspace === undefined) delete process.env.GITHUB_WORKSPACE
    else process.env.GITHUB_WORKSPACE = originalWorkspace
  })

  it('does nothing when all inputs are empty', async () => {
    await run()
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalledWith(
      'tf-vars-map',
      JSON.stringify([])
    )
  })

  it('throws an error when variables is not a valid JSON object', async () => {
    core.getInput.mockImplementation((name) => {
      if (name === 'variables') return 'invalid json'
      return '' // Default for other inputs
    })
    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Cannot parse JSON variables')
    )
  })

  it('throws an error when secrets is not a valid JSON object', async () => {
    core.getInput.mockImplementation((name) => {
      if (name === 'variables') return '{}'
      if (name === 'secrets') return 'invalid json'
      return ''
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Cannot parse JSON secrets')
    )
  })

  it('throws an error when convertInputs is not a valid JSON array', async () => {
    core.getInput.mockImplementation((name) => {
      if (name === 'variables') return '{}'
      if (name === 'secrets') return '{}'
      if (name === 'convertInputs') return 'invalid json'
      return ''
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Cannot parse JSON list of inputs')
    )
  })
  it('throws an error when additionalInputs is not a valid JSON object', async () => {
    core.getInput.mockImplementation((name) => {
      if (name === 'variables') return '{}'
      if (name === 'secrets') return '{}'
      if (name === 'convertInputs') return '{}'
      if (name === 'additionalInputs') return 'invalid json'
      return ''
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Cannot parse JSON list of inputs')
    )
  })

  it('correctly processes listInputs and calls createKeyValue', async () => {
    core.getInput.mockImplementation((name) => {
      if (name === 'variables') return JSON.stringify({ VAR_KEY: 'value1' })
      if (name === 'secrets') return JSON.stringify({ SECRET_KEY: 'value2' })
      if (name === 'convertInputs')
        return JSON.stringify(['stack.dns.var.test_var'])
      return ''
    })

    await run()

    expect(createKeyValue).toHaveBeenCalledTimes(1)
    expect(createKeyValue).toHaveBeenCalledWith(
      process.cwd(),
      'stack.dns.var.test_var',
      {
        var: { VAR_KEY: 'value1' },
        secret: { SECRET_KEY: 'value2' }
      },
      null,
      true,
      false,
      { config: {}, pipeline: {}, secretBackend: 'gh', vaultStore: null }
    )
    expect(core.setOutput).toHaveBeenCalledWith(
      'tf-vars-map',
      JSON.stringify([{ key: 'test_key', value: 'test_value' }])
    )
  })

  it('processes additionalInputs and adds them to convertInputs list output', async () => {
    core.getInput.mockImplementation((name) => {
      if (name === 'variables') return JSON.stringify({ VAR_KEY: 'value1' })
      if (name === 'secrets') return JSON.stringify({ SECRET_KEY: 'value2' })
      if (name === 'convertInputs')
        return JSON.stringify(['stack.dns.var.test_var'])
      if (name === 'additionalInputs')
        return JSON.stringify({ stack: 'unitteststack' })
      return ''
    })

    await run()

    expect(createKeyValue).toHaveBeenCalledTimes(1)
    expect(createKeyValue).toHaveBeenCalledWith(
      process.cwd(),
      'stack.dns.var.test_var',
      {
        var: { VAR_KEY: 'value1' },
        secret: { SECRET_KEY: 'value2' }
      },
      null,
      true,
      false,
      { config: {}, pipeline: {}, secretBackend: 'gh', vaultStore: null }
    )

    expect(core.setOutput).toHaveBeenCalledWith(
      'tf-vars-map',
      JSON.stringify([
        { key: 'test_key', value: 'test_value' },
        { key: 'stack', value: 'unitteststack' }
      ])
    )
  })
  it('handles empty listInputs gracefully', async () => {
    core.getInput.mockImplementation((name) => {
      if (name === 'variables') return '{}'
      if (name === 'secrets') return '{}'
      if (name === 'convertInputs') return JSON.stringify([])
      return ''
    })

    await run()

    expect(createKeyValue).not.toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalledWith(
      'tf-vars-map',
      JSON.stringify([])
    )
  })
  it('filters excluded secrets while preserving allowed and typed nested inputs', async () => {
    createKeyValue.mockImplementation(originalCreateKeyValue)
    const input = {
      image: {
        credential: 'gh.secret.BUILD_TOKEN',
        enabled: true,
        retries: 2,
        labels: ['packer', 'linux']
      }
    }

    core.getInput.mockImplementation((name) => {
      if (name === 'secrets')
        return JSON.stringify({
          INFRA_TOKEN: 'blocked',
          BUILD_TOKEN: 'allowed'
        })
      if (name === 'excluded-secrets') return JSON.stringify(['infra_token'])
      if (name === 'convertInputs') return JSON.stringify([input])
      return ''
    })

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(createKeyValue).toHaveBeenCalledWith(
      process.cwd(),
      input,
      {
        var: {},
        secret: { BUILD_TOKEN: 'allowed' }
      },
      null,
      true,
      false,
      { config: {}, pipeline: {}, secretBackend: 'gh', vaultStore: null }
    )
    expect(core.setOutput).toHaveBeenCalledWith(
      'tf-vars-map',
      JSON.stringify([
        {
          key: 'image',
          value: {
            credential: 'allowed',
            enabled: true,
            retries: 2,
            labels: ['packer', 'linux']
          }
        }
      ])
    )
  })

  it('treats a reference to an excluded secret as missing', async () => {
    createKeyValue.mockImplementation(originalCreateKeyValue)
    core.getInput.mockImplementation((name) => {
      if (name === 'secrets')
        return JSON.stringify({ INFRA_TOKEN: 'must-not-be-exposed' })
      if (name === 'excluded-secrets') return JSON.stringify(['INFRA_TOKEN'])
      if (name === 'convertInputs')
        return JSON.stringify(['gh.secret.INFRA_TOKEN'])
      return ''
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      'Value is undefined, null, or empty'
    )
    expect(core.setOutput).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid JSON', 'not-json'],
    ['a non-array value', '{}'],
    ['an empty secret name', '[""]'],
    ['a whitespace-only secret name', '["  "]'],
    ['a non-string secret name', '["VALID", 1]']
  ])('rejects excluded-secrets containing %s', async (_case, value) => {
    core.getInput.mockImplementation((name) => {
      if (name === 'excluded-secrets') return value
      return ''
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      'Cannot parse JSON excluded-secrets. Expected a JSON array of nonempty strings.'
    )
    expect(createKeyValue).not.toHaveBeenCalled()
    expect(core.setOutput).not.toHaveBeenCalled()
  })

  it('keeps secrets available when excluded-secrets is omitted', async () => {
    createKeyValue.mockImplementation(originalCreateKeyValue)
    core.getInput.mockImplementation((name) => {
      if (name === 'secrets')
        return JSON.stringify({ LEGACY_TOKEN: 'available' })
      if (name === 'convertInputs')
        return JSON.stringify(['gh.secret.LEGACY_TOKEN'])
      return ''
    })

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalledWith(
      'tf-vars-map',
      JSON.stringify([{ key: 'LEGACY_TOKEN', value: 'available' }])
    )
  })

  it.each(['', 'gh'])(
    'resolves explicit secrets from GitHub with secret-backend=%s and masks the value',
    async (backend) => {
      createKeyValue.mockImplementation(originalCreateKeyValue)
      core.getInput.mockImplementation((name) => {
        if (name === 'secret-backend') return backend
        if (name === 'secrets')
          return JSON.stringify({ TOKEN: 'private-value' })
        if (name === 'convertInputs')
          return JSON.stringify([{ credential: 'secret_backend.secret.token' }])
        return ''
      })

      await run()

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(core.setSecret).toHaveBeenCalledWith('private-value')
      expect(core.setOutput).toHaveBeenCalledWith(
        'tf-vars-map',
        JSON.stringify([{ key: 'credential', value: 'private-value' }])
      )
      expect(core.info.mock.calls.flat().join(' ')).not.toContain(
        'private-value'
      )
    }
  )

  it('rejects keyvault backend without a Key Vault URL even with SSM configured and allowNull enabled', async () => {
    core.getInput.mockImplementation((name) => {
      if (name === 'secret-backend') return 'keyvault'
      if (name === 'ssm-parameter-prefix') return '/infra'
      if (name === 'allowNull') return 'true'
      if (name === 'convertInputs')
        return JSON.stringify(['secret_backend.secret.token'])
      return ''
    })

    await run()

    expect(core.setFailed).toHaveBeenCalled()
    expect(core.setOutput).not.toHaveBeenCalled()
  })

  it.each(['ssm', 'vault'])(
    'rejects invalid backend %s before output',
    async (backend) => {
      core.getInput.mockImplementation((name) =>
        name === 'secret-backend' ? backend : ''
      )
      await run()
      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining(`Invalid secret-backend: ${backend}`)
      )
      expect(core.setOutput).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['the basePath input over GITHUB_WORKSPACE', '/input', '/ws', '/input'],
    ['GITHUB_WORKSPACE without basePath', '', '/ws', '/ws'],
    ['cwd without basePath or GITHUB_WORKSPACE', '', undefined, process.cwd()]
  ])(
    'resolves the base path from %s',
    async (_case, basePath, workspace, expected) => {
      if (workspace !== undefined) process.env.GITHUB_WORKSPACE = workspace
      core.getInput.mockImplementation((name) => {
        if (name === 'basePath') return basePath
        if (name === 'convertInputs')
          return JSON.stringify(['stack.dns.var.test_var'])
        return ''
      })

      await run()

      expect(createKeyValue).toHaveBeenCalledTimes(1)
      expect(createKeyValue.mock.calls[0][0]).toBe(expected)
    }
  )

  describe('step-output on Windows without RUNNER_TEMP', () => {
    const originalRunnerTemp = process.env.RUNNER_TEMP
    const originalPlatform = Object.getOwnPropertyDescriptor(
      process,
      'platform'
    )!

    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      delete process.env.RUNNER_TEMP
      createKeyValue.mockImplementation(originalCreateKeyValue)
    })

    afterEach(() => {
      Object.defineProperty(process, 'platform', originalPlatform)
      if (originalRunnerTemp === undefined) delete process.env.RUNNER_TEMP
      else process.env.RUNNER_TEMP = originalRunnerTemp
    })

    it.each(['', 'step-output'])(
      'preserves ordered typed inputs with output-mode=%s',
      async (outputMode) => {
        core.getInput.mockImplementation((name) => {
          if (name === 'output-mode') return outputMode
          if (name === 'secrets') return JSON.stringify({ TOKEN: 'private' })
          if (name === 'convertInputs')
            return JSON.stringify([
              { count: 2 },
              { config: { enabled: true, tags: ['a', 'b'] } },
              { token: 'gh.secret.token' }
            ])
          if (name === 'additionalInputs')
            return JSON.stringify({ tail: 'last' })
          return ''
        })

        await run()

        expect(core.setFailed).not.toHaveBeenCalled()
        expect(createKeyValue).toHaveBeenCalledTimes(3)
        expect(core.setOutput).toHaveBeenCalledTimes(1)
        expect(core.setOutput).toHaveBeenCalledWith(
          'tf-vars-map',
          JSON.stringify([
            { key: 'count', value: 2 },
            { key: 'config', value: { enabled: true, tags: ['a', 'b'] } },
            { key: 'token', value: 'private' },
            { key: 'tail', value: 'last' }
          ])
        )
      }
    )
  })

  describe('output-mode private-file', () => {
    const originalRunnerTemp = process.env.RUNNER_TEMP
    let runnerTemp: string

    beforeEach(async () => {
      runnerTemp = await mkdtemp(path.join(tmpdir(), 'runner-temp-'))
      process.env.RUNNER_TEMP = runnerTemp
      createKeyValue.mockImplementation(originalCreateKeyValue)
    })

    afterEach(async () => {
      await rm(runnerTemp, { recursive: true, force: true })
      if (originalRunnerTemp === undefined) delete process.env.RUNNER_TEMP
      else process.env.RUNNER_TEMP = originalRunnerTemp
    })

    const privateInputs =
      (inputs: unknown[], extra: Record<string, string> = {}) =>
      (name: string) => {
        if (name === 'output-mode') return 'private-file'
        if (name === 'convertInputs') return JSON.stringify(inputs)
        if (name === 'secrets')
          return JSON.stringify({ APP_TOKEN: 'line1\nline2' })
        return extra[name] ?? ''
      }

    it('writes typed values to a 0600 file and publishes only its path', async () => {
      core.getInput.mockImplementation(
        privateInputs([
          { app_token: 'gh.secret.app_token' },
          { replicas: 2 },
          { settings: { enabled: true, tags: ['a', 'b'] } }
        ])
      )

      await run()

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(core.setOutput).toHaveBeenCalledTimes(1)
      const [name, file] = core.setOutput.mock.calls[0] as [string, string]
      expect(name).toBe('resolved-inputs-file')
      const directory = path.dirname(file)
      expect(path.dirname(directory)).toBe(runnerTemp)
      expect(path.basename(directory)).toMatch(/^resolved-stack-inputs-/)
      expect((await stat(directory)).mode & 0o777).toBe(0o700)
      expect((await stat(file)).mode & 0o777).toBe(0o600)
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
        app_token: 'line1\nline2',
        replicas: 2,
        settings: { enabled: true, tags: ['a', 'b'] }
      })
    })

    it('keeps successive private files independent and does not overwrite the first', async () => {
      core.getInput.mockImplementation(privateInputs([{ token: 'first' }]))
      await run()
      expect(core.setFailed).not.toHaveBeenCalled()
      const [firstOutput, firstFile] = core.setOutput.mock.calls[0] as [
        string,
        string
      ]
      expect(firstOutput).toBe('resolved-inputs-file')
      expect(JSON.parse(await readFile(firstFile, 'utf8'))).toEqual({
        token: 'first'
      })

      core.getInput.mockImplementation(privateInputs([{ token: 'second' }]))
      await run()

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(core.setOutput).toHaveBeenCalledTimes(2)
      const [secondOutput, secondFile] = core.setOutput.mock.calls[1] as [
        string,
        string
      ]
      expect(secondOutput).toBe('resolved-inputs-file')
      expect(secondFile).not.toBe(firstFile)
      expect(path.dirname(path.dirname(firstFile))).toBe(runnerTemp)
      expect(path.dirname(path.dirname(secondFile))).toBe(runnerTemp)
      expect(await readdir(runnerTemp)).toHaveLength(2)
      expect(JSON.parse(await readFile(firstFile, 'utf8'))).toEqual({
        token: 'first'
      })
      expect(JSON.parse(await readFile(secondFile, 'utf8'))).toEqual({
        token: 'second'
      })
    })

    it('rejects duplicate input names without writing a file', async () => {
      core.getInput.mockImplementation(
        privateInputs([{ token: 'a' }], { additionalInputs: '{"token":"b"}' })
      )

      await run()

      expect(core.setFailed).toHaveBeenCalledWith('Duplicate input name: token')
      expect(core.setOutput).not.toHaveBeenCalled()
      expect(await readdir(runnerTemp)).toEqual([])
    })

    it('rejects Windows before resolving inputs without touching existing files', async () => {
      const sentinel = path.join(runnerTemp, 'sentinel')
      await writeFile(sentinel, 'keep')
      core.getInput.mockImplementation(privateInputs([{ token: 'a' }]))
      const originalPlatform = Object.getOwnPropertyDescriptor(
        process,
        'platform'
      )!
      Object.defineProperty(process, 'platform', { value: 'win32' })
      try {
        await run()
      } finally {
        Object.defineProperty(process, 'platform', originalPlatform)
      }

      expect(core.setFailed).toHaveBeenCalledWith(
        'output-mode private-file is supported only on Linux and macOS'
      )
      expect(createKeyValue).not.toHaveBeenCalled()
      expect(core.setOutput).not.toHaveBeenCalled()
      expect(await readdir(runnerTemp)).toEqual(['sentinel'])
      expect(await readFile(sentinel, 'utf8')).toBe('keep')
    })

    it('requires RUNNER_TEMP before resolving inputs without touching existing files', async () => {
      const sentinel = path.join(runnerTemp, 'sentinel')
      await writeFile(sentinel, 'keep')
      delete process.env.RUNNER_TEMP
      core.getInput.mockImplementation(privateInputs([{ token: 'a' }]))

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        'RUNNER_TEMP is required for output-mode private-file'
      )
      expect(createKeyValue).not.toHaveBeenCalled()
      expect(core.setOutput).not.toHaveBeenCalled()
      expect(await readdir(runnerTemp)).toEqual(['sentinel'])
      expect(await readFile(sentinel, 'utf8')).toBe('keep')
    })
  })

  it('rejects an unknown output-mode', async () => {
    core.getInput.mockImplementation((name) => {
      if (name === 'output-mode') return 'stdout'
      if (name === 'convertInputs') return JSON.stringify([{ token: 'a' }])
      return ''
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      'Invalid output-mode: stdout. Expected step-output or private-file.'
    )
    expect(createKeyValue).not.toHaveBeenCalled()
    expect(core.setOutput).not.toHaveBeenCalled()
  })
})
