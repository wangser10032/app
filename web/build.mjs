// Development containers set NODE_ENV=development. Always emit production React
// in exported assets, independently of the host shell or operating system.
process.env.NODE_ENV = 'production';
const { build } = await import('vite');
await build();
