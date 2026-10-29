// A development container may export NODE_ENV=development. Force optimized React
// in the final assets on both Linux and Windows without shell-specific syntax.
process.env.NODE_ENV = 'production';
const { build } = await import('vite');
await build();
