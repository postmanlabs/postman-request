import {Http2Agent} from "./http2Agent";
import {request} from "./request";

export default  {
    Agent: Http2Agent,
    request: request,
    globalAgent: new Http2Agent({})

}
