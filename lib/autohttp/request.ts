import * as http from "http";
import * as http2 from "http2";
import {EventEmitter} from "events";
import { RequestOptions, Request as HTTP2Request} from '../../lib/http2/request'
import {AutoHttp2Agent} from "./agent";
import {ClientRequest} from "http";



interface AutoRequestOptions extends Omit<RequestOptions, 'agent'>{
    agent: AutoHttp2Agent;
}


// @ts-ignore
export class MultiProtocolRequest extends EventEmitter implements http.ClientRequest {
    private queuedOps: any[] = [];
    private options: AutoRequestOptions;

    constructor(options: AutoRequestOptions) {
        super();
        this.onHttp2 = this.onHttp2.bind(this);
        this.onHttp = this.onHttp.bind(this);
        this.options = options;

        // Request agent to perform alpn and return either an http agent or https agent
        // Pass the request to the agent, the agent then emits http or h2 event based on the result of alpn negotiation


        const agent = options.agent;
        // @ts-ignore
        agent.createConnection(this, options);
        this.registerAgentCallback(agent);


    }

    registerAgentCallback(agent: AutoHttp2Agent){
        agent.once('h2', this.onHttp2);
        agent.once('socket', (socket) => this.emit('socket', socket));
        agent.once('http1', this.onHttp);
    }

    onHttp2(connection: http2.ClientHttp2Session){
        // @ts-ignore
        const options: RequestOptions = this.options;
        // @ts-ignore
        options.agent = {
            createConnection: () => connection
        }
        const req = new HTTP2Request(options)
        this.registerCallbacks(req);
        this.processQueuedOpens(req);
    }

    onHttp(req: ClientRequest){
        this.registerCallbacks(req);
        this.processQueuedOpens(req);
    }

    registerCallbacks(ob: any) {
        ob.on('drain', (...args) => this.emit('drain', ...args))
        ob.on('error', (...args) => this.emit('error', ...args))
        ob.on('data', (...args) => this.emit('data', ...args))
        ob.on('end', (...args) => this.emit('end', ...args))
        ob.on('close', (...args) => this.emit('close', ...args))
        ob.on('socket', (...args) => this.emit('socket', ...args))
        ob.on('response', (...args) => this.emit('response', ...args))

        ob.once('error', (...args) => this.emit('error', ...args))
    }

    private processQueuedOpens(ob: any) {

        this.queuedOps.forEach(([op, ...args]) => {
            if (op === 'end') {
                ob.end()
            }

            if (op === 'write') {
                ob.write(...args)
            }

            if (op === 'setDefaultEncoding'){
                ob.setDefaultEncoding(args);
            }

            if (op === 'pipe'){
                ob.pipe(...args);
            }

            if(op === 'setTimeout'){
                ob.setTimeout(...args);
            }
        })
    }

    write (data: any) {
        this.queuedOps.push(['write', data]);
        return true;
    }

    end() {
        this.queuedOps.push(['end']);
        return this;
    }

    setDefaultEncoding(encoding: BufferEncoding): this {
        this.queuedOps.push(['setDefaultEncoding', encoding])
        return this;
    }

    pipe<T extends NodeJS.WritableStream>(destination: T, options?: { end?: boolean | undefined; } | undefined): T {
        this.queuedOps.push(['pipe', destination, options]);
        return destination;
    }

    setTimeout(timeout: number, callback?: (() => void) | undefined): this {
        this.queuedOps.push(['setTimeout', timeout, callback]);
        return this;
    
    }
}

export function request(options: RequestOptions): http.ClientRequest {
    // request was received here, that means protocol is auto, that means priority order is http2, http
    // There can be 2 cases

    // 2. We have performed ALPN negotiation before for this host/port with the same agent options
    // 3. We need to perform ALPN negotiation, add the socket used to perform negotiation to the appropriate agent
    // 3.1 Add the agent to the pool if it didn't already exist


    // socket.enableTrace()
    //@ts-ignore
    return new MultiProtocolRequest( options);
}

