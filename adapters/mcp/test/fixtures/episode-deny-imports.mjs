import { register } from 'node:module';

globalThis.fetch = () => { throw new Error('episode_access_network_forbidden'); };
register(new URL('./episode-loader.mjs', import.meta.url), import.meta.url);
