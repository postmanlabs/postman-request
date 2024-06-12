import {Agent} from 'https';
import {Http2Agent, HTTP2ClientRequestOptions} from "../http2/http2Agent";
import * as https from "https";
import * as http2 from "http2";
import * as http from "http";
import {AutoRequestOptions, MultiProtocolRequest} from "./request";
import * as tls from "tls";
import {EventEmitter} from "events";

interface CreateConnectionCallback {
    (err: null | Error, proto: 'h2', connection: http2.ClientHttp2Session)

    (err: null | Error, proto: 'http1', connection: http.ClientRequest)

    (err: Error)
}

// @ts-ignore
export class AutoHttp2Agent extends EventEmitter implements Agent {
    private http2Agent: Http2Agent;
    private httpsAgent: https.Agent;
    private ALPNCache: Map<string, Map<number, string>>;
    defaultPort = 443;

    constructor(options: https.AgentOptions) {
        super();
        this.http2Agent = new Http2Agent(options);
        this.httpsAgent = new https.Agent(options);
        this.ALPNCache = new Map();
    }

    createConnection(req: MultiProtocolRequest, options: AutoRequestOptions, cb: CreateConnectionCallback, socketCb: (socket: tls.TLSSocket)=>void) {
        // @ts-ignore
        const uri = options.uri;
        const port = Number(options.port || this.defaultPort);
        // check if there is ALPN cached
        // TODO: Replace map of map cache with getName based cache
        const hostnameCache = this.ALPNCache.get(uri.hostname) ?? new Map<number, string>();
        const protocol = hostnameCache.get(port);
        if (protocol === 'h2') {
            const newOptions: HTTP2ClientRequestOptions = {
                ...options,
                port,
                path: options.socketPath,
                host: options.hostname || options.host || 'localhost'
            };
            const connection = this.http2Agent.createConnection(req, uri, newOptions);
            cb(null, 'h2', connection);
            socketCb(connection.socket as tls.TLSSocket);
            return;
        }
        if (protocol === 'http/1.1' || protocol === 'http/1.0') {

            const requestOptions: https.RequestOptions = {
                ...options,
                agent: this.httpsAgent,
                host: options.hostname || options.host || 'localhost'
            };

            const request = https.request(requestOptions);
            request.on('socket', (socket)=>socketCb(socket as tls.TLSSocket))
            cb(null, 'http1', request);
            return;
        }

        const newOptions: tls.ConnectionOptions = {
            ...options,
            port,
            path: options.socketPath,
            ALPNProtocols: ['h2', 'http/1.1', 'http/1.0'],
            // TODO: Handle servername taking node:http.Agent calculateServerName as reference
            servername: options.headers['host'] ?? uri.hostname,
            host: options.hostname || options.host || 'localhost'
        }

        const socket = tls.connect(newOptions);
        socketCb(socket);
        socket.on('error', (e) => cb(e));
        socket.once('secureConnect', () => {
            const protocol = socket.alpnProtocol;
            if (!protocol) {
                cb(socket.authorizationError, null, null);
                socket.end();
                return;
            }

            const hostnameCache = this.ALPNCache.get(uri.hostname);
            if (!hostnameCache) {
                const portMap = new Map<number, string>();
                portMap.set(port, protocol);
                this.ALPNCache.set(uri.hostname, portMap);
            } else {
                hostnameCache.set(port, protocol);
            }

            if (protocol === 'h2') {
                const newOptions: HTTP2ClientRequestOptions = {
                    ...options,
                    port,
                    path: options.socketPath,
                    host: options.hostname || options.host || 'localhost'
                };

                const connection = this.http2Agent.createConnection(req, uri, newOptions, socket);
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
                    ...options,
                    agent: this.httpsAgent,
                    host: options.hostname || options.host || 'localhost'
                };


                const request = https.request(requestOptions);
                // @ts-ignore
                this.httpsAgent.createConnection = oldCreateConnection;
                cb(null, 'http1', request);

            } else {
                cb(new Error('Unknown protocol' + protocol), null, null);
                return;

            }
        })

    }


}
