const request = require('./index');
const { Readable } = require('stream');
const fs = require('fs')

// Create a streaming response to send over the wire
const body = new Readable({
  read() {
    this.push('Hello World!');
    this.push(null);
  }
});

// request("https://postman-echo.com/get",{protocol: 'http1'}, (err, resp, body)=>console.log(body))
const TEST_URL = "https://postman-echo.com/post";
const httpsurl = 'https://localhost:8000'
const http2url = 'https://localhost:3000/h2'
const h2request = request(TEST_URL,{
  protocol: 'h2',
  timing:true,
  strictSSL:false,
  method: 'POST',
  body,
  // verbose: true,
  // ca: fs.readFileSync('/etc/ssl/cert.pem'),
  key: fs.readFileSync('/Users/jonathan.havivpostman.com/openssl/client-key.pem'),
  cert: fs.readFileSync('/Users/jonathan.havivpostman.com/openssl/client-cert.pem')
}, (err, resp, body)=> console.log(`http2 received:
body: ${ body }
timing: ${ JSON.stringify(resp.timingPhases) }
`))



// const h1request = request(TEST_URL,{
//   protocol: 'http1',
//   timing:true,
//   strictSSL:false,
//   method: 'POST',
//   body,
//   // ca: fs.readFileSync('/etc/ssl/cert.pem'),
//   key: fs.readFileSync('/Users/jonathan.havivpostman.com/openssl/client-key.pem'),
//   cert: fs.readFileSync('/Users/jonathan.havivpostman.com/openssl/client-cert.pem')
// }, (err, resp, body)=> console.log(`http1 received:
// body: ${ body }
// timing: ${ JSON.stringify(resp.timingPhases) }`))

const autoRequest = request(TEST_URL,{
  protocol: 'auto',
  timing:true,
  strictSSL:false,
  method: 'POST',
  body,
  // ca: fs.readFileSync('/etc/ssl/cert.pem'),
  key: fs.readFileSync('/Users/jonathan.havivpostman.com/openssl/client-key.pem'),
  cert: fs.readFileSync('/Users/jonathan.havivpostman.com/openssl/client-cert.pem')
}, (err, resp, body)=> console.log(`auto received:
body: ${ body }
timing: ${ JSON.stringify(resp.timingPhases) }`))