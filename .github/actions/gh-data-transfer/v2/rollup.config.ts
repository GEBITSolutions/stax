// rollup.config.ts
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

export default {
  input: 'src/index.ts',
  output: {
    file: 'dist/index.cjs',
    format: 'cjs',
    sourcemap: true,
    exports: 'auto',
    inlineDynamicImports: true
  },
  plugins: [
    typescript({
      tsconfig: './tsconfig.json'
    }),
    resolve({
      preferBuiltins: true,
      browser: false,
      exportConditions: ['node']
    }),
    commonjs({
      include: /node_modules/,
      transformMixedEsModules: true
    }),
    json()
  ],
  external: [] // dont externalize dependencies
}
