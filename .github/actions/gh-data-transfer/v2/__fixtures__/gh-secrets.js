// __fixtures__/gh-secrets.js
import { jest } from '@jest/globals'

export const write_secrets_to_gh_env = jest
  .fn()
  .mockImplementation(() => Promise.resolve())
