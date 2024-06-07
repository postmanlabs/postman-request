import * as http from "http";
import * as http2 from "http2";
import {EventEmitter} from "events";
import { RequestOptions, Http2Request as HTTP2Request} from '../../lib/http2/request'
import {AutoHttp2Agent} from "./agent";
import {ClientRequest} from "http";



interface AutoRequestOptions extends Omit<RequestOptions, 'agent'>{
    agent: AutoHttp2Agent;
}


// @ts-ignore
export class MultiProtocolRequest extends EventEmitter implements http.ClientRequest {
    private queuedOps: any[] = [];
    private options: AutoRequestOptions;
    private _req: http.ClientRequest | HTTP2Request;

    constructor(options: AutoRequestOptions) {
        super();
        this.onHttp2 = this.onHttp2.bind(this);
        this.onHttp = this.onHttp.bind(this);
        this.onSocket = this.onSocket.bind(this);
        this.registerAgentCallback = this.registerAgentCallback.bind(this);
        this.options = options;

        const agent = options.agent;
        // Request agent to perform alpn and return either an http agent or https agent
        // Pass the request to the agent, the agent then calls the callback with http or h2 argument based on the result of alpn negotiation
        // @ts-ignore
        agent.createConnection(this, options, (proto, req)=>{
            if(proto === 'h2'){
                this.onHttp2(req);
            }
            if(proto === 'http1'){
                this.onHttp(req);
            }
        });


    }

    private onSocket(socket: any){
        this.emit('socket', socket);
    }
    registerAgentCallback(agent: AutoHttp2Agent){
        agent.once('socket', this.onSocket);
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
        this._req = req;
    }


    onHttp(req: ClientRequest){
        this.registerCallbacks(req);
        this.processQueuedOpens(req);
        this._req = req;
    }

    registerCallbacks(ob: any) {
        ob.on('drain', (...args) => this.emit('drain', ...args))
        ob.on('error', (...args) => this.emit('error', ...args))

        ob.on('end', (...args) => this.emit('end', ...args))
        ob.on('close', (...args) => {this.emit('close', ...args);

        })
        ob.on('socket', (...args) => this.emit('socket', ...args))
        ob.on('response', (...args) => {
            this.emit('response', ...args)})

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
            if(op === 'abort'){
                ob.abort();
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

    abort(): this {
        if(this._req){
            this._req.abort();
            return this;
        }
        this.queuedOps.push(['abort']);
        return this;
    }
}

export function request(options: RequestOptions): http.ClientRequest {
    // request was received here, that means protocol is auto, that means priority order is http2, http
    // There can be 2 cases

    // 1. We have performed ALPN negotiation before for this host/port with the same agent options
    // 2. We need to perform ALPN negotiation, add the socket used to perform negotiation to the appropriate agent
    // 2.1 Add the agent to the pool if it didn't already exist


    // socket.enableTrace()
    //@ts-ignore
    return new MultiProtocolRequest( options);
}

