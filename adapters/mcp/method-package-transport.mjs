import {StdioServerTransport} from '@modelcontextprotocol/server/stdio';

export const METHOD_TRANSPORT_BYTES=262144;
// Opt-in only. Bound the complete encoded JSON-RPC message (including its ID
// and newline), independently of the core envelope and escaped tool framing.
export class MethodStdioServerTransport extends StdioServerTransport {
  constructor(input,output){super(input,output,{maxBufferSize:METHOD_TRANSPORT_BYTES});}
  send(message){
    if(Buffer.byteLength(JSON.stringify(message),'utf8')+1>METHOD_TRANSPORT_BYTES){
      const error=Error('method_transport_response_too_large');this.onerror?.(error);return Promise.reject(error);
    }
    return super.send(message);
  }
}
