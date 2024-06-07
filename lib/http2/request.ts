import { URL } from "url";
import * as http from "http";
import * as http2 from "http2";
import { EventEmitter } from "events";
import { Http2Agent } from "./http2Agent";

export interface RequestOptions {
  path: string;
  method: string;
  headers?: Record<string, string>;
  rejectUnauthorized?: boolean;
  extraCA?: string;
  cert?: Buffer;
  ca?: Buffer;
  key?: Buffer;
  pfx?: Buffer;
  passphrase?: string;
  port?: number;
  protocol: "auto" | "h2" | "http1";
  proxy?: unknown;
  uri: URL;
  ciphers?: string;
  secureProtocol?: string;
  secureOptions?: number;
  agent?: Http2Agent;
  agentOptions: {
    timeout?: number;
  };
}

export class Http2Request extends EventEmitter {
  stream: http2.ClientHttp2Stream;
  private _client: http2.ClientHttp2Session;

  constructor(options: RequestOptions) {
    super();
    this.onError = this.onError.bind(this);
    this.registerListeners = this.registerListeners.bind(this);
    const headers = options.headers;

    // @ts-ignore
    const uri: URL = options.uri;
    const newoptions:
      | http2.ClientSessionOptions
      | http2.SecureClientSessionOptions = { ...options.agentOptions };

    // @ts-ignore
    newoptions.ca = options.ca;
    // @ts-ignore
    newoptions.key = options.key;
    // @ts-ignore
    newoptions.cert = options.cert;
    // @ts-ignore
    newoptions.rejectUnauthorized = options.rejectUnauthorized;

    // @ts-ignore
    const client = options.agent.createConnection(this, uri, newoptions);
    const path = options.path;
    const method = options.method;

    const requestHeaders = {
      [http2.constants.HTTP2_HEADER_PATH]: path,
      [http2.constants.HTTP2_HEADER_METHOD]: method,
      ...headers,
    };
    delete requestHeaders["Connection"];

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
      // TODO: Refactor this logic to be more elegant
      // setImmediate(() => {
      //   this.stream.resume();
      // });
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

  setEncoding(encoding) {
    this.stream.setEncoding(encoding);
  }

  write(chunk) {
    this.stream.write(chunk);
  }

  pipe(dest) {
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
  
}
export function request(options): http.ClientRequest {
  // @ts-ignore
  return new Http2Request(options);
}

class ResponseProxy extends EventEmitter {
  private req: Http2Request;
  private response: http2.IncomingHttpHeaders;
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
    this.req.stream.on("close", () => this.emit("close"));
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
    return Object.entries(this.response)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\r\n");
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

 

  setTimeout(timeout, cb) {
    this.req.stream.setTimeout(timeout, cb);
  }

}
