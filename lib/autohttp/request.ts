import * as http from "http";
import * as http2 from "http2";
import {EventEmitter} from "events";
import { RequestOptions, Http2Request as HTTP2Request} from '../../lib/http2/request'
import {AutoHttp2Agent} from "./agent";
import {ClientRequest} from "http";
import type * as tls from 'tls';


export interface AutoRequestOptions extends Omit<RequestOptions, 'agent'>{
    agent?: AutoHttp2Agent;
}


// @ts-ignore
export class MultiProtocolRequest extends EventEmitter implements http.ClientRequest {
    private queuedOps: any[] = [];
    private options: AutoRequestOptions;
    private _req: http.ClientRequest | HTTP2Request;
    socket: tls.TLSSocket

    constructor(options: AutoRequestOptions) {
        super();
        this.onHttp2 = this.onHttp2.bind(this);
        this.onHttp = this.onHttp.bind(this);
        this.options = options;
        this.options.host = options.hostname || options.host || 'localhost';

        const agent = options.agent;
        // Request agent to perform alpn and return either an http agent or https agent
        // Pass the request to the agent, the agent then calls the callback with http or h2 argument based on the result of alpn negotiation
        // @ts-ignore
        agent.createConnection(this, options, (err, proto, req)=>{
            if(err){
                this.emit('error', err);
                return;
            }
            if(proto === 'h2'){
                this.onHttp2(req);
            }
            if(proto === 'http1'){
                this.onHttp(req);
            }
        }, (socket)=>{
            // Socket from agent will not be called if ALPN cache already exists
            // Thus, we maintain a flag to check either the socket callback from agent is emitted,
            // and only emit socket event from request if this callback isn't called

            // Need to register callback after this tick, after the on socket handlers have been registered.
            // Node also does something similar when emitting the socket event.
            process.nextTick(()=>this.emit('socket', socket));
            this.socket = socket;
        });


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
        ob.on('response', (...args) => {
            this.emit('response', ...args)})

        ob.once('error', (...args) => this.emit('error', ...args))
    }

    private processQueuedOpens(ob: any) {

        this.queuedOps.forEach(([op, ...args]) => {
            if (op === 'end') {
                ob.end(...args)
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
        this.queuedOps = [];
    }

    write (data: any) {
        if(this._req){
            this._req.write(data);
            return true;
        }
        this.queuedOps.push(['write', data]);
        return true;
    }

    end(data: any) {
        if (this._req){
            this._req.end(data)
            return this;
        }
        this.queuedOps.push(['end', data]);
        return this;
    }

    setDefaultEncoding(encoding: BufferEncoding): this {
        if(this._req){
            this._req.setDefaultEncoding(encoding);
            return this;
        }

        this.queuedOps.push(['setDefaultEncoding', encoding])
        return this;
    }

    pipe<T extends NodeJS.WritableStream>(destination: T, options?: { end?: boolean | undefined; } | undefined): T {
        if(this._req){
            this._req.pipe(destination, options);
            return destination;
        }
        this.queuedOps.push(['pipe', destination, options]);
        return destination;
    }

    setTimeout(timeout: number, callback?: (() => void) | undefined): this {
        if(this._req){
            // @ts-ignore
            this._req.setTimeout(timeout, callback());
            return this;
        }
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

