import {URL} from "node:url";
import {RequestOptions} from "https";
import * as http from "http";
import * as https from "https";
import * as tls from 'tls';
import {EventEmitter} from "node:events";
import {request as http2Request} from '../../lib/http2/request'

function parseSession(buf) {
    return {
        sessionId: buf.slice(17, 17 + 32).toString('hex'),
        masterKey: buf.slice(51, 51 + 48).toString('hex')
    };
}

// @ts-ignore
class MultiProtocolRequest extends EventEmitter implements http.ClientRequest {
    private socket: tls.TLSSocket;
    private queuedOps: string[] = [];

    constructor(socket: tls.TLSSocket, options: RequestOptions) {
        super();
        this.socket = socket;
        this.emit('socket', socket);
        this.socket.on('error', (e) => this.emit('error', e))
        this.socket.on('tlsClientError', (e) => this.emit('error', e))
        this.socket.once('secureConnect', () => {
            const protocol = this.socket.alpnProtocol;
            if (!protocol) {
                this.emit('error', this.socket.authorizationError)
                this.socket.end();
                return;
            }


            options.createConnection = () => {
                return this.socket
            };
            let req;
            if (protocol === 'h2') {
                // @ts-ignore
                req = http2Request({...options});
            } else if (protocol === 'http/1.1') {
                req = https.request(options);
            } else {
                this.emit('error', 'Unknown protocol' + protocol)
                return;

            }
            this.registerCallbacks(req);
            this.processQueuedOpens(req);

        })
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
        this.queuedOps.forEach((op) => {
            if (op === 'end') {
                ob.end()
            }
        })
    }

    end() {
        this.queuedOps.push('end');
        return this;
    }
}

export function request(options: RequestOptions): http.ClientRequest {
    options.port = Number(options.port)
    // @ts-ignore
    const uri: URL = options.uri;

    const newOptions: tls.ConnectionOptions = {
        port: options.port ? Number(options.port) : 443,
        ALPNProtocols: ['h2'],
        ca: options.ca,
        key: options.key,
        cert: options.cert,
        host: uri.hostname,
        servername: uri.hostname,
        rejectUnauthorized: options.rejectUnauthorized
        // minVersion: "TLSv1.3",
        // maxVersion: "TLSv1.3"
    }

    const socket = tls.connect(newOptions);
    // socket.enableTrace()
    //@ts-ignore
    return new MultiProtocolRequest(socket, options);
}

