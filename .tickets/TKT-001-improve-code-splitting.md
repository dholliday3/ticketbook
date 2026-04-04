---
id: TKT-001
title: improve code splitting
status: done
priority: low
project: cleanups
created: '2026-04-03T19:47:54.666Z'
updated: '2026-04-03T19:58:11.897Z'
---

I'm seeing these issues when building vite: \
`cd packages/ui && bun run build`\
\
(!) Some chunks are larger than 500 kB after minification. Consider:

- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: <https://rollupjs.org/configuration-options/#output-manualchunks>
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
