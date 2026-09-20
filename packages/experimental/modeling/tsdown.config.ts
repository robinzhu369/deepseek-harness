import type { UserConfig } from 'tsdown'
import { clientBundle } from '../../client/tsdown.client.ts'

const companions: UserConfig[] = ['tools', 'policy'].map(entry => ({
  entry: [`lib/types/${entry}.js`],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}))

/** Build the Host gateway, generated Remote descriptors, browser UI, and preset-local entries. */
export default clientBundle(
  '@deepseek-ai/dsh-experimental-modeling',
  ['lib/types/index.js'],
  { hostPhase: true, companions },
)
