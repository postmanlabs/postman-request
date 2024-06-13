import {URL} from "url";
import * as http from "http";
import * as http2 from "http2";
import {EventEmitter} from "events";
import type * as https from 'https';
import {type Http2Agent, HTTP2ClientRequestOptions, globalAgent} from "./http2Agent";


export interface RequestOptions extends Omit<https.RequestOptions, 'agent' | 'createConnection' | 'protocol'> {
    agent?: Http2Agent;
    protocol?: 'https:'
}

function httpOptionsToUri(options: RequestOptions): URL {
    const url = new URL('https://'+ (options.host || 'localhost'));
    return url;
}

export class Http2Request extends EventEmitter {
    stream: http2.ClientHttp2Stream;
    private _client: http2.ClientHttp2Session;

    constructor(options: RequestOptions) {
        super();
        this.onError = this.onError.bind(this);
        this.registerListeners = this.registerListeners.bind(this);
        const headers = options.headers;

        const uri = httpOptionsToUri(options);
        const newoptions: HTTP2ClientRequestOptions = {
            ...options,
            port: Number(options.port || 443),
            path: undefined,
            host: options.hostname || options.host || 'localhost'
        };

        if (options.socketPath) {
            options.path = options.socketPath;
        }

        const agent = options.agent || globalAgent;

        const client = agent.createConnection(this, uri, newoptions);

        const requestHeaders = {
            [http2.constants.HTTP2_HEADER_PATH]: options.path || '/',
            [http2.constants.HTTP2_HEADER_METHOD]: options.method,
            [http2.constants.HTTP2_HEADER_AUTHORITY]: uri.hostname,
            ...headers,
        };

        // Remove blacklisted http/1 headers
        delete requestHeaders["Connection"];
        delete requestHeaders['Host'];

        this.stream = client.request(requestHeaders);
        this._client = client;
        this.registerListeners();
    }

    get _header() {
        return Object.entries(this.stream.sentHeaders)
            .map(([key, value]) => `${key}: ${value}`)
            .join("/r/n");
    }

    get httpVersion() {
        return "2.0";
    }

    private registerListeners() {
        this.stream.on("drain", (...args) => this.emit("drain", ...args));
        this.stream.on("error", (...args) => this.emit("error", ...args));


        this.stream.on("close", (...args) => {
            this.emit("close", ...args);
        });
        this.stream.on("socket", () => this.emit("socket", this._client.socket));
        this._client.once("error", this.onError);
        this.stream.on("response", (response) => {
            this.emit("response", new ResponseProxy(response, this));

            // HTTP response events returns a readable stream which has data event that consumers listen on to get the response body
            // With HTTP2 the response object is a header object and the body is streamed via the data event.
            // To maintain compatibilty with the HTTP API, we need to emit the data after the response event is emitted
            // And wait for the data listeners to be attached
        });
        //
        this.stream.on("end", () => {
            this._client.off("error", this.onError);
            this.emit("end");

        });
    }

    private onError(e) {
        this.emit("error", e);
    }

    setDefaultEncoding(encoding: BufferEncoding): this {
        this.stream.setDefaultEncoding(encoding);
        return this;
    }

    setEncoding(encoding: BufferEncoding) {
        this.stream.setEncoding(encoding);
    }

    write(chunk: any) {
        this.stream.write(chunk);
    }

    pipe(dest: any) {
        this.stream.pipe(dest);
    }

    on(eventName: string | symbol, listener: (...args: any[]) => void): this {
        if (eventName === "socket") {
            listener(this._client.socket);
            return this;
        }

        return super.on(eventName, listener);
    }


    abort() {
        this.stream.destroy();
    }

    end() {
        this.stream.end();
    }

    setTimeout(timeout: number, cb: () => void){
        this.stream.setTimeout(timeout, cb);
    }

}

export function request(options: RequestOptions): http.ClientRequest {
    // @ts-ignore
    return new Http2Request(options);
}

class ResponseProxy extends EventEmitter {
    private readonly req: Http2Request;
    private readonly response: http2.IncomingHttpHeaders;
    httpVersion: string = "2.0";

    constructor(response: http2.IncomingHttpHeaders, request: Http2Request) {
        super();
        this.req = request;
        this.response = response;
        this.on = this.on.bind(this);
        this.registerRequestListeners();
    }

    registerRequestListeners() {

        this.req.stream.on("end", () => this.emit("end"));
        this.req.stream.on("error", (e) => this.emit("error", e));
        this.req.stream.on("close", () => {
            this.emit("close")
        });
    }

    on(eventName: string | symbol, listener: (...args: any[]) => void): this {
        super.on(eventName, listener);
        if (eventName === "data") {

            // Attach the data listener to the request stream only when there is a listener.
            // This is because the data event is emitted by the request stream and the response stream is a proxy
            // that forwards the data event to the response object.
            // If there is no listener attached and we use the event forwarding pattern above, the data event will still be emitted
            // but with no listeners attached to it, thus causing data loss.
            this.req.stream.on("data", (chunk) => {

                this.emit("data", chunk);
            });
        }
        return this;
    }

    get statusCode() {
        return this.response[http2.constants.HTTP2_HEADER_STATUS];
    }

    get rawHeaders() {
        let headersArray =  Object.entries(this.response).flat()
        const setCookieHeaderIndex = headersArray.findIndex(key => key === http2.constants.HTTP2_HEADER_SET_COOKIE);
        if (setCookieHeaderIndex !== -1){
            const setCookieHeadersArray = (this.response[http2.constants.HTTP2_HEADER_SET_COOKIE] as string[]).map((val)=>([
                http2.constants.HTTP2_HEADER_SET_COOKIE,
                val
            ])).flat();
            headersArray = headersArray.slice(0,setCookieHeaderIndex).concat(setCookieHeadersArray, headersArray.slice(setCookieHeaderIndex+2))
        }

        return headersArray;
    }

    get headers() {
        return this.response;
    }

    pause() {
        this.req.stream.pause();
    }

    resume() {
        this.req.stream.resume();
    }

    pipe(dest: any) {
        this.req.stream.pipe(dest);
    }

    setEncoding(encoding: BufferEncoding) {
        this.req.stream.setEncoding(encoding);
    }
}
