import { defineConfig } from 'vite'

// Config for the demo app only (`bun run dev` / `bun run build:demo` / `bun run preview`).
// The library itself is built separately via `tsc -p tsconfig.build.json` (see package.json's
// "build" script) into ./dist, which this outDir must not collide with.
export default defineConfig({
  build: {
    outDir: 'dist-demo',
  },
})
