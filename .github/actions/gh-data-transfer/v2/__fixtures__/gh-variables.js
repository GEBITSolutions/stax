// __fixtures__/gh-variables.js
import { jest } from '@jest/globals'

export const write_variables_to_gh_env = jest
  .fn()
  .mockImplementation(() => Promise.resolve())
