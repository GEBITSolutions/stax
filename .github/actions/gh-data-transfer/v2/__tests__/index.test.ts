import { describe, expect, test, jest, beforeEach } from '@jest/globals'

const mockRun = jest.fn<() => Promise<void>>().mockResolvedValue(undefined)

// Mock @octokit/rest before any imports
jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({}))
}))

jest.mock('../src/keyvault-store.js', () => ({
  KeyVaultStore: jest.fn().mockImplementation(() => ({
    setSecret: jest.fn(),
    setSecrets: jest.fn(),
    getSecret: jest.fn()
  }))
}))

// Mock the main module before it's imported by index
jest.mock('../src/main.js', () => ({
  run: mockRun
}))

// The index.ts file simply imports and runs the main function
// We're testing that it properly exports and calls run()
describe('index', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('should export and call run function', async () => {
    // Import index which should call run()
    await import('../src/index.js')

    // The run function should be called when index is imported
    expect(mockRun).toHaveBeenCalled()
  })
})
