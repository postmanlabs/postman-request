import {URL} from "node:url";
import {RequestOptions} from "https";
import * as http from "http";
import * as http2 from 'http2';
import {EventEmitter} from "node:events";

export function request(options: RequestOptions, callback?: (res: http.IncomingMessage) => void ): http.ClientRequest{
    const headers = options.headers;

    // @ts-ignore
    const uri:URL = options.uri;
    const newoptions: http2.ClientSessionOptions | http2.SecureClientSessionOptions = {}

    if(options.createConnection){
        // @ts-ignore
        newoptions.createConnection = options.createConnection;
    }
    else{
        // @ts-ignore
        newoptions.ca = options.ca;
        // @ts-ignore
        newoptions.key = options.key;
        // @ts-ignore
        newoptions.cert = options.cert;
        // @ts-ignore
        newoptions.rejectUnauthorized = options.rejectUnauthorized;
    }


        // @ts-ignore
    const client = http2.connect(uri, newoptions);

    const path = options.path
    const method = options.method;
    const req = client.request({[http2.constants.HTTP2_HEADER_PATH]: path, [http2.constants.HTTP2_HEADER_METHOD]: method, ...headers })
    req.on('end', () => {
        client.close();
    })
    req.on('error',()=>{
        console.log(req.rstCode)
    })

    //@ts-ignore
    return new DummyClientRequest(req, client);

}


class DummyClientRequest extends EventEmitter implements http.ClientRequest  {
    private _req: http2.ClientHttp2Stream;
    private _client: http2.ClientHttp2Session
    private response: http2.IncomingHttpHeaders;
    constructor(req: http2.ClientHttp2Stream, client: http2.ClientHttp2Session){
        super();
        this._req = req;
        this._client = client;
        this.on = this.on.bind(this);
        this.once = this.once.bind(this)
        this.registerListeners();
    }

    get _header(){
        return Object.entries(this._req.sentHeaders).map(([key, value])=>`${key}: ${value}`).join('/r/n')
    }

    get httpVersion(){
        return '2.0'
    }

    get rawHeaders(){
        return Object.entries(this.response).map(([key, value])=>`${key}: ${value}`).join('/r/n')
    }

    get statusCode(){
        return this.response[http2.constants.HTTP2_HEADER_STATUS];
    }

    setDefaultEncoding(encoding: BufferEncoding): this {
        this._req.setDefaultEncoding(encoding)
        return this;
    }
    // on(event:string, cb){
    //     console.log('event registered', event);
    //     return super.on(event, cb)
    // }
    private registerListeners(

    ){
        this._req.on('drain', (...args)=>this.emit('drain', ...args))
        this._req.on('error', (...args)=>this.emit('error', ...args))
        this._req.on('data', (...args)=>this.emit('data', ...args))
        this._req.on('end', (...args)=>this.emit('end', ...args))
        this._req.on('close', (...args)=>this.emit('close', ...args))
        this._req.on('socket', (...args)=>this.emit('socket', this._client.socket))
        this._client.on('error', (...args)=>this.emit('error', ...args))
        this._req.on('response', (response)=>{
            console.log(response)
            this.response = response;
            this.emit('response',this);
        } )
        //
        this._req.once('end', () => this.emit('end'))
        this._req.once('close', () => this.emit('close'))
        // this._req.once('error', (...args) => this.emit('error', ...args))
        // this._client.once('error', (...args) => this.emit('error', ...args))
    }


    write (data: any) {
        return this._req.write(data);
    }

    // @ts-ignore
    end(){
        this._req.end()
    }


}
