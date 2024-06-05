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

export class Request extends EventEmitter {
  private _req: http2.ClientHttp2Stream;
  private _client: http2.ClientHttp2Session;
  private response: http2.IncomingHttpHeaders;

  constructor(options: RequestOptions) {
    super();
    this.onError = this.onError.bind(this);

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
    this._req = client.request({
      [http2.constants.HTTP2_HEADER_PATH]: path,
      [http2.constants.HTTP2_HEADER_METHOD]: method,
      ...headers,
    });
    this._client = client;
    this.registerListeners();
  }

  get _header() {
    return Object.entries(this._req.sentHeaders)
      .map(([key, value]) => `${key}: ${value}`)
      .join("/r/n");
  }

  get httpVersion() {
    return "2.0";
  }

  get rawHeaders() {
    return Object.entries(this.response)
      .map(([key, value]) => `${key}: ${value}`)
      .join("/r/n");
  }

  get headers() {
    return this.response;
  }

  get statusCode() {
    return this.response[http2.constants.HTTP2_HEADER_STATUS];
  }

  private registerListeners() {
    this._req.on("drain", (...args) => this.emit("drain", ...args));
    this._req.on("error", (e) => console.log(e));
    this._req.on("error", (...args) => this.emit("error", ...args));
    this._req.on("data", (...args) => this.emit("data", ...args));
    this._req.on("end", (...args) => {
      this.emit("end", ...args);
    });
    this._req.on("close", (...args) => {
      this.emit("close", ...args);
    });
    this._req.on("socket", () => this.emit("socket", this._client.socket));
    this._client.once("error", this.onError);
    this._req.on("response", (response) => {

      this.response = response;
      this.emit("response", this);
    });
    //
    this._req.once("end", () => {
      this._client.off("error", this.onError);
      this.emit("end");
    });
  }

  private onError(e) {
    this.emit("error", e);
  }

  setDefaultEncoding(encoding: BufferEncoding): this {
    this._req.setDefaultEncoding(encoding);
    return this;
  }

  setEncoding(encoding) {
    this._req.setEncoding(encoding);
  }

  write(chunk) {
    this._req.write(chunk);
  }

  pipe(dest) {
    this._req.pipe(dest);
  }

  on(eventName: string | symbol, listener: (...args: any[]) => void): this {
    if (eventName === "socket") {
      listener(this._client.socket);
      return this;
    }
    return super.on(eventName, listener);
  }

  pause(){
    this._req.pause();
  }

  resume(){
    this._req.resume();
  }

  // @ts-ignore
  end() {
    this._req.end();
  }
}
export function request(options): http.ClientRequest {
  // @ts-ignore
  return new Request(options);
}
