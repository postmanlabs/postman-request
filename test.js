const request = require('./index');

const fs = require('fs')
// request("https://postman-echo.com/get",{protocol: 'http1'}, (err, resp, body)=>console.log(body))
const TEST_URL = "https://postman-echo.com/get";
const httpsurl = 'https://localhost:443'
const http2url = 'https://localhost:3000/h2'
const r = request(TEST_URL,{
  protocol: 'auto',
  timing:true,
  strictSSL:false,
  // ca: fs.readFileSync('/etc/ssl/cert.pem'),
  // key: fs.readFileSync('/Users/parth.verma@postman.com/temp/t/key.pem'),
  // cert: fs.readFileSync('/Users/parth.verma@postman.com/temp/t/cert.pem')
}, (err, resp, body)=>console.log({ body }))
