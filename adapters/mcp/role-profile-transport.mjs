import { ContextStdioServerTransport } from './context-read-transport.mjs';
export { roleTaskToolResponse } from '../../core/role-context-wire.mjs';

// Same complete JSON-RPC/newline ceiling as the other opted-in read tools.
export class RoleProfileStdioServerTransport extends ContextStdioServerTransport {}
