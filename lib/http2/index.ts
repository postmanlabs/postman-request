import {Http2Agent, globalAgent} from "./http2Agent";
import {request} from "./request";

export default  {
    Agent: Http2Agent,
    request: request,
    globalAgent
}
