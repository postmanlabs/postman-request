import {URL} from "node:url";
import {RequestOptions} from "https";
import * as http from "http";
import * as http2 from 'http2';
export function request(options: RequestOptions, callback?: (res: http.IncomingMessage) => void ): http.ClientRequest{
    const ca = options.ca;
    const key = options.key;
    const rejectUnauthorized = options.rejectUnauthorized;
    const headers = options.headers;
    const cert = options.cert;

    // @ts-ignore
    const uri:URL = options.uri;


    const client = http2.connect(uri, {
        ca,
        key,
        cert,
        rejectUnauthorized,
    });

    const path = options.path
    const method = options.method;
    const req = client.request({[http2.constants.HTTP2_HEADER_PATH]: path, [http2.constants.HTTP2_HEADER_METHOD]: method, ...headers })
    req.on('end', () => {
        client.close();
    })

    //@ts-ignore
    return new DummyClientRequest(req, client);

}


// @ts-ignore
class DummyClientRequest implements http.ClientRequest {
    private _req: http2.ClientHttp2Stream;
    private _client: http2.ClientHttp2Session
    constructor(req: http2.ClientHttp2Stream, client: http2.ClientHttp2Session){
        this._req = req;
        this._client = client;
        this.on = this.on.bind(this);
        this.once = this.once.bind(this)
    }

    get _header(){
        return Object.entries(this._req.sentHeaders).map(([key, value])=>`${key}: ${value}`).join('/r/n')
    }

    get httpVersion(){
        return '2.0'
    }

    setDefaultEncoding(encoding: BufferEncoding): this {
        this._req.setDefaultEncoding(encoding)
        return this;
    }


    on(eventName:string, cb: (arg1: any, arg2?: any, arg3?: any)=>void){
        if(eventName === 'drain'){
            this._req.on('drain', cb)
        }
        else if(eventName === 'error'){
            this._req.on('error', cb);
        }
        else if(eventName === 'response'){
            this._req.on('response', (response)=>{
                cb({
                    statusCode: response[http2.constants.HTTP2_HEADER_STATUS],
                    rawHeaders: Object.entries(response).map(([key, value])=>`${key}: ${value}`).join('/r/n'),
                    on: this.on,
                    once: this.once,
                    httpVersion: this.httpVersion
                })

            })
        }
        else if(eventName === 'data'){
            this._req.on('data', cb)
        }
        else if(eventName === 'end'){
            this._req.on('end', cb);
        }

        else if(eventName === 'close'){
            this._req.on('close', cb);
        }
        else if(eventName === 'socket'){
            cb(this._client.socket)
        }
        else if(eventName === 'error'){
            this._req.on('error', cb);
            this._client.on('error', cb);
        }


        else {
            console.log('unknown eventName', eventName, 'received')
        }

        return this;
    }
    once(eventName, cb){
        if(eventName === 'end'){
            this._req.on('end', cb);
        }

        else if(eventName === 'close'){
            this._req.on('close', cb);
        }
        else if(eventName === 'error'){
            this._req.once('error', cb);
            this._client.once('error', cb);
        }
        else {
            console.log('unknown once eventName', eventName, 'received')
        }
        return this;
    }

    // @ts-ignore
    end(){
        this._req.end()
    }


}
