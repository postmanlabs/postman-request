import {EventEmitter} from "events";
import * as http2 from "http2";
import * as tls from "tls";
import type * as https from 'https';

export interface HTTP2ClientRequestOptions extends Omit<http2.SecureClientSessionOptions, 'createConnection'> {
    localAddress?: string;
}

export class Http2Agent extends EventEmitter {
    private readonly options: http2.SecureClientSessionOptions;
    private readonly connections: Record<string, http2.ClientHttp2Session> = {};

    // sockets: Record<string, tls.TLSSocket> = {};

    constructor(options: https.AgentOptions) {
        super();
        this.options = options;
    }

    createConnection(req, uri: URL, options: HTTP2ClientRequestOptions, socket?: tls.TLSSocket) {
        const _options = {...options, ...this.options};
        const name = this.getName(_options)
        // TODO: Handle socketpath to path conversion
        let connection = this.connections[name];


        if (!connection || connection.destroyed || connection.closed) {
            // check if a socket is supplied

            let connectionOptions: http2.SecureClientSessionOptions = {};

            // TODO: Handle localaddress options

            // Omitting create connections since there is a signature mismatch b/w http1 and http2 and we don't want to mess with it.
            connectionOptions = {..._options, createConnection: undefined, port: _options.port || 443};

            if (socket) {
                connectionOptions.createConnection = () => socket;
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
                if (this.refCount > 0) {
                    oldRef.call(this)
                }
            }
            connection.unref = function () {
                this.refCount--;
                if (this.refCount === 0) {
                    oldUnref.call(this)

                }
            }

            connection.once('connect', () => {

                // start the timeout only when the connection is in ready state, otherwise the connection closes early
                connection.setTimeout(options?.timeout ?? 30000, () => {

                    //@ts-ignore
                    if (connection.refCount === 0) {

                        connection.close(() => {
                            connection.destroy();
                        });
                        delete this.connections[name];
                    }
                })
            });

            this.connections[name] = connection;
        }
        connection.ref();
        req.once('close', () => {
            connection.unref();
        })

        return connection;

    }


    getName(options: HTTP2ClientRequestOptions) {
        let name = options.host || 'localhost';

        name += ':';
        if (options.port)
            name += options.port;

        name += ':';
        if (options.localAddress)
            name += options.localAddress;

        if (options.path)
            name += `:${options.path}`;

        name += ':';
        if (options.ca)
            name += options.ca;

        name += ':';
        if (options.cert)
            name += options.cert;

        name += ':';
        if (options.clientCertEngine)
            name += options.clientCertEngine;

        name += ':';
        if (options.ciphers)
            name += options.ciphers;

        name += ':';
        if (options.key)
            name += options.key;

        name += ':';
        if (options.pfx)
            name += options.pfx;

        name += ':';
        if (options.rejectUnauthorized !== undefined)
            name += options.rejectUnauthorized;

        name += ':';
        if (options.servername && options.servername !== options.host)
            name += options.servername;

        name += ':';
        if (options.minVersion)
            name += options.minVersion;

        name += ':';
        if (options.maxVersion)
            name += options.maxVersion;

        name += ':';
        if (options.secureProtocol)
            name += options.secureProtocol;

        name += ':';
        if (options.crl)
            name += options.crl;

        name += ':';
        if (options.honorCipherOrder !== undefined)
            name += options.honorCipherOrder;

        name += ':';
        if (options.ecdhCurve)
            name += options.ecdhCurve;

        name += ':';
        if (options.dhparam)
            name += options.dhparam;

        name += ':';
        if (options.secureOptions !== undefined)
            name += options.secureOptions;

        name += ':';
        if (options.sessionIdContext)
            name += options.sessionIdContext;

        name += ':';
        if (options.sigalgs)
            name += JSON.stringify(options.sigalgs);

        name += ':';
        if (options.privateKeyIdentifier)
            name += options.privateKeyIdentifier;

        name += ':';
        if (options.privateKeyEngine)
            name += options.privateKeyEngine;

        return name;
    }

}

// export const
export const globalAgent = new Http2Agent({});
