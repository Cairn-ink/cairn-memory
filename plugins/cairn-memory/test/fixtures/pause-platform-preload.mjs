// Exercise an unsupported shared-lock platform without native host state.
Object.defineProperty(process, 'platform', { value: 'freebsd' });
process.getuid = undefined;
process.channel?.unref();
