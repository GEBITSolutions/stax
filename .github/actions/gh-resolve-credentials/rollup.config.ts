import path from 'node:path'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import nodeResolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

export default {
  input: 'src/index.ts',
  output: {
    esModule: true,
    file: 'dist/index.js',
    format: 'es',
    sourcemap: true,
    inlineDynamicImports: true
  },
  plugins: [
    typescript(),
    nodeResolve({
      preferBuiltins: true,
      dedupe: ['@actions/core', '@azure/identity', '@azure/keyvault-secrets'],
      exportConditions: ['node'],
      // Imported converter source must use this action's installed dependencies.
      modulePaths: [path.resolve('node_modules')]
    }),
    commonjs(),
    json()
  ]
}
