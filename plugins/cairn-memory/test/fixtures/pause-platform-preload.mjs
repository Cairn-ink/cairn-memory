// Exercise an unsupported shared-lock platform without native host state.
Object.defineProperty(process, 'platform', { value: 'win32' });
process.getuid = undefined;
process.channel?.unref();
