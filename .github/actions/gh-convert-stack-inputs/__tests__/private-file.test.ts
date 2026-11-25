import { jest } from '@jest/globals'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const writeFile = jest.fn<typeof fs.writeFile>()
jest.unstable_mockModule('node:fs/promises', () => ({ ...fs, writeFile }))
// Load after registering the ESM mock so the writer uses the injected failure.
const { writePrivateInputsFile } = await import('../src/private-file.js')

it('removes only its own directory when writing fails', async () => {
  const runnerTemp = await fs.mkdtemp(path.join(tmpdir(), 'private-inputs-'))
  const sentinel = path.join(runnerTemp, 'sentinel')
  try {
    await fs.writeFile(sentinel, 'keep')
    writeFile.mockRejectedValueOnce(new Error('write failed'))

    await expect(
      writePrivateInputsFile([{ key: 'token', value: 'secret' }], runnerTemp)
    ).rejects.toThrow('write failed')
    expect(await fs.readdir(runnerTemp)).toEqual(['sentinel'])
    expect(await fs.readFile(sentinel, 'utf8')).toBe('keep')
  } finally {
    await fs.rm(runnerTemp, { recursive: true, force: true })
  }
})
