import {Agent} from 'https';
import {Http2Agent, type AgentOptions as Http2AgentOptions} from "../http2/http2Agent";
import * as https from "https";
import * as http2 from "http2";
import * as http from "http";
import {RequestOptions} from "../http2/request";
import {MultiProtocolRequest} from "./request";
import * as tls from "tls";
import {EventEmitter} from "events";


interface AgentOptions extends Http2AgentOptions {
}

interface CreateConnectionCallback{
    (err:null | Error, proto:'h2', connection: http2.ClientHttp2Session)
    (err:null | Error, proto:'http1', connection: http.ClientRequest)
    (err: Error)
}

// @ts-ignore
export class AutoHttp2Agent extends EventEmitter implements Agent {
    private http2Agent: Http2Agent;
    private httpsAgent: https.Agent;
    private ALPNCache: Map<string, Map<number, string>>;

    constructor(options: AgentOptions) {
        super();
        this.http2Agent = new Http2Agent(options);
        // @ts-ignore
        this.httpsAgent = new https.Agent({...options, ...options.agentOptions});
        this.ALPNCache = new Map();
    }

    createConnection(req: MultiProtocolRequest, options: RequestOptions, cb: CreateConnectionCallback) {
        const uri = options.uri;
        const port = Number.parseInt(options.port ?? '443');
        // check if there is ALPN cached
        const hostnameCache = this.ALPNCache.get(uri.hostname) ?? new Map<number, string>();
        const protocol = hostnameCache.get(port);
        if (protocol === 'h2') {

            // @ts-ignore
            const connection = this.http2Agent.createConnection(req, uri, options);
            // console.log('emitting h2');
            cb(null, 'h2', connection);
            return;
        }
        if(protocol === 'http/1.1' || protocol === 'http/1.0'){

            const requestOptions: https.RequestOptions = {
                port,
                host: uri.hostname,
                method: options.method,
                path: options.path,
                headers: options.headers,
                agent: this.httpsAgent,
                ca: options.ca,
                key: options.key,
                cert: options.cert,
                rejectUnauthorized: options.rejectUnauthorized
            };

            const request = https.request(requestOptions);
            cb(null, 'http1', request);
            return;
        }

        const newOptions: tls.ConnectionOptions = {
            port,
            ALPNProtocols: ['h2','http/1.1', 'http/1.0'],
            ca: options.ca,
            key: options.key,
            cert: options.cert,
            host: uri.hostname,
            servername: uri.hostname,
            rejectUnauthorized: options.rejectUnauthorized,
        }

        const socket = tls.connect(newOptions);
        socket.once('secureConnect', () => {
            const protocol = socket.alpnProtocol;
            if (!protocol) {
                cb(socket.authorizationError, null, null);
                socket.end();
                return;
            }

            const hostnameCache = this.ALPNCache.get(uri.hostname);
            if(!hostnameCache){
                const portMap = new Map<number, string>();
                portMap.set(port, protocol);
                this.ALPNCache.set(uri.hostname, portMap);
            } else {
                hostnameCache.set(port, protocol);
            }

            this.emit('socket', socket);

            // options.createConnection = () => {
            //     return this.socket
            // };

            if (protocol === 'h2') {
                // @ts-ignore
                const connection = this.http2Agent.createConnection(req, uri, options, socket);
                cb(null, 'h2', connection);
            } else if (protocol === 'http/1.1') {
                // Protocol is http1, using the built in
                // We need to release all free sockets so that new connection is created using the overriden createconnection forcing the agent to reuse the socket used for alpn


                // This reassignment works, since all code so far is sync, and happens in the same tick, hence there will be no race conditions
                // @ts-ignore
                const oldCreateConnection = this.httpsAgent.createConnection;
                // @ts-ignore
                this.httpsAgent.createConnection = () => {
                    return socket
                };
                const requestOptions: https.RequestOptions = {
                    // agent: this.httpsAgent,
                    port,
                    host: options.uri.hostname,
                    method: options.method,
                    path: options.path,
                    headers: options.headers,
                    agent: this.httpsAgent
                    // createConnection: () => socket
                    // timeout: 5000
                };



                const request = https.request(requestOptions);
                // @ts-ignore
                this.httpsAgent.createConnection = oldCreateConnection;
                // this.emit('http1', request);
                cb(null, 'http1', request);

            } else {
                cb(new Error('Unknown protocol' + protocol), null, null);
                return;

            }
            // this.registerCallbacks(req);
            // this.processQueuedOpens(req);

        })

    }


}
