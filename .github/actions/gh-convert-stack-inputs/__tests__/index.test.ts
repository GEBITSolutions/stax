import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import { createKeyValue as originalCreateKeyValue } from '../src/converter.js'

const createKeyValue = jest.fn(originalCreateKeyValue)

jest.unstable_mockModule('@actions/core', () => core)
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
      null
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
      null
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
      null
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
})
