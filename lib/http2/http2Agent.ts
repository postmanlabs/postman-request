import {EventEmitter} from "node:events";
import * as http2 from "http2";
import * as tls from "tls";
import {RequestOptions} from "./request";

interface Options {
    host?: string;
    port?: string;
    localAddress?: string;

}

export interface AgentOptions{
    ca?: Buffer;
    extraCa?:string;
    ciphers?: string;
    secureProtocol?: string;
    secureOptions?: number;
    rejectUnauthorized?: boolean;
    key?: Buffer;
    cert?: Buffer;
    pfx?: Buffer;
    passphrase?:string;

}

export class Http2Agent extends EventEmitter {
    private options: AgentOptions;
    private connections: Record<string, http2.ClientHttp2Session> = {};
    // sockets: Record<string, tls.TLSSocket> = {};

    constructor(options: AgentOptions){
        super();
        this.options = options;
    }

    createConnection(req, uri: URL, options: RequestOptions, socket?: tls.TLSSocket) {
        const name = this.getName(uri)

        let connection = this.connections[name];

        if (!connection || connection.destroyed || connection.closed) {
            // check if a socket is supplied
            let connectionOptions: http2.SecureClientSessionOptions = {};
            if(socket){
                connectionOptions.createConnection = () => socket;
            }
            else {

                connectionOptions = {
                    ...options,
                    protocol: 'https:'
                }
            }

            connection = http2.connect(uri, connectionOptions);


            // Counting semaphore, but since node is single-threaded, this is a stupid man's semaphore
            // Multiple streams can be active on a connection
            // Each stream refs the connection at the start, and unrefs it on end
            // The connection should terminate if no streams are active on it
            // Could be refactored into something prettier
            const oldRef = connection.ref;
            const oldUnref = connection.unref;
            // @ts-ignore
            connection.refCount = 0;
            connection.ref = function () {
                this.refCount++;
                console.log('refing', this.refCount);
                if (this.refCount > 0) {
                    oldRef.call(this)
                }
            }
            connection.unref = function () {
                this.refCount--;
                console.log('unrefing', this.refCount)
                if (this.refCount === 0) {
                    oldUnref.call(this)

                }
            }

            connection.once('ready', () => {
                // start the timeout only when the connection is in ready state, otherwise the connection closes early
                connection.setTimeout(options?.agentOptions?.timeout ?? 5000, () => {
                    console.log('timeout')
                    this.connections[name] = undefined;
                    connection.close();
                    // console.log('timeout', options.timeout)
                })
            });

            connection.on('close', () => {
                console.log('closing the connection');
            })

            this.connections[name] = connection;
        }
        connection.ref();
        req.once('close', () => {
            connection.unref();
        })

        return connection;

    }


    getName(options: Options) {
        let name = options.host || 'localhost';

        name += ':';
        if (options.port)
            name += options.port;

        name += ':';
        if (options.localAddress)
            name += options.localAddress;

        // Pacify parallel/test-http-agent-getname by only appending
        // the ':' when options.family is set.
        // if (options.family === 4 || options.family === 6)
        //     name += `:${options.family}`;

        // if (options.socketPath)
        //     name += `:${options.socketPath}`;

        return name;
    }

}

// export const
