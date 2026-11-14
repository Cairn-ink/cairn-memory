// Inject the native platform capability without accessing a real host profile.
Object.defineProperty(process, 'platform', { value: 'win32' });
process.getuid = undefined;
process.channel?.unref();
