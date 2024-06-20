'use strict'

var server = require('./server')
var request = require('../index')
var tape = require('tape')
var path = require('path')
var fs = require('fs')

var s = server.createHttp2Server()

tape('setup', function (t) {
  s.listen(0, function () {
    t.end()
  })
})

function addTest (name, data) {
  tape('test ' + name, function (t) {
    s.on('/' + name, data.resp)
    data.uri = s.url + '/' + name
    request(
      { ...data, protocolVersion: 'http2', strictSSL: false },
      function (err, resp, body) {
        t.equal(err, null)
        if (data.expectBody && Buffer.isBuffer(data.expectBody)) {
          t.deepEqual(data.expectBody.toString(), body.toString())
        } else if (data.expectBody) {
          t.deepEqual(data.expectBody, body)
        }
        t.end()
      }
    )
  })
}

addTest('testGet', {
  resp: server.createGetResponse('TESTING!'),
  expectBody: 'TESTING!'
})

addTest('testGetChunkBreak', {
  resp: server.createChunkResponse([
    Buffer.from([239]),
    Buffer.from([163]),
    Buffer.from([191]),
    Buffer.from([206]),
    Buffer.from([169]),
    Buffer.from([226]),
    Buffer.from([152]),
    Buffer.from([131])
  ]),
  expectBody: '\uF8FF\u03A9\u2603'
})

addTest('testGetBuffer', {
  resp: server.createGetResponse(Buffer.from('TESTING!')),
  encoding: null,
  expectBody: Buffer.from('TESTING!')
})

addTest('testGetEncoding', {
  resp: server.createGetResponse(Buffer.from('efa3bfcea9e29883', 'hex')),
  encoding: 'hex',
  expectBody: 'efa3bfcea9e29883'
})

addTest('testGetUTF', {
  resp: server.createGetResponse(
    Buffer.from([0xef, 0xbb, 0xbf, 226, 152, 131])
  ),
  encoding: 'utf8',
  expectBody: '\u2603'
})

addTest('testGetJSON', {
  resp: server.createGetResponse('{"test":true}', 'application/json'),
  json: true,
  expectBody: { test: true }
})

addTest('testPutString', {
  resp: server.createPostValidator('PUTTINGDATA'),
  method: 'PUT',
  body: 'PUTTINGDATA'
})

addTest('testPutBuffer', {
  resp: server.createPostValidator('PUTTINGDATA'),
  method: 'PUT',
  body: Buffer.from('PUTTINGDATA')
})

addTest('testPutJSON', {
  resp: server.createPostValidator(JSON.stringify({ foo: 'bar' })),
  method: 'PUT',
  json: { foo: 'bar' }
})

addTest('testPutMultipart', {
  resp: server.createPostValidator(
    '--__BOUNDARY__\r\n' +
      'content-type: text/html\r\n' +
      '\r\n' +
      '<html><body>Oh hi.</body></html>' +
      '\r\n--__BOUNDARY__\r\n\r\n' +
      'Oh hi.' +
      '\r\n--__BOUNDARY__--'
  ),
  method: 'PUT',
  multipart: [
    { 'content-type': 'text/html', body: '<html><body>Oh hi.</body></html>' },
    { body: 'Oh hi.' }
  ]
})

addTest('testPutMultipartPreambleCRLF', {
  resp: server.createPostValidator(
    '\r\n--__BOUNDARY__\r\n' +
      'content-type: text/html\r\n' +
      '\r\n' +
      '<html><body>Oh hi.</body></html>' +
      '\r\n--__BOUNDARY__\r\n\r\n' +
      'Oh hi.' +
      '\r\n--__BOUNDARY__--'
  ),
  method: 'PUT',
  preambleCRLF: true,
  multipart: [
    { 'content-type': 'text/html', body: '<html><body>Oh hi.</body></html>' },
    { body: 'Oh hi.' }
  ]
})

addTest('testPutMultipartPostambleCRLF', {
  resp: server.createPostValidator(
    '\r\n--__BOUNDARY__\r\n' +
      'content-type: text/html\r\n' +
      '\r\n' +
      '<html><body>Oh hi.</body></html>' +
      '\r\n--__BOUNDARY__\r\n\r\n' +
      'Oh hi.' +
      '\r\n--__BOUNDARY__--' +
      '\r\n'
  ),
  method: 'PUT',
  preambleCRLF: true,
  postambleCRLF: true,
  multipart: [
    { 'content-type': 'text/html', body: '<html><body>Oh hi.</body></html>' },
    { body: 'Oh hi.' }
  ]
})

tape('testBinaryFile', function (t) {
  s.on('/', function (req, res) {
    req.pipe(res)
    // Close the session if it's a HTTP/2 request. This is not representative of a true http/2 server that might keep the session open. But we need this to close the server in the tests.
    req.stream && req.stream.session && req.stream.session.close && req.stream.session.close()
  })

  request(
    {
      uri: 'https://localhost:' + s.port,
      method: 'POST',
      strictSSL: false,
      protocolVersion: 'http2',
      body: fs.createReadStream(path.join(__dirname, 'raw.file'))
    },
    function (err, res, body) {
      t.error(err) // defaults to 'application/octet-stream' content-type
      t.equal(res.request.headers['Content-Type'], 'application/octet-stream')
      s.removeAllListeners('/')
      t.end()
    }
  )
})

tape('typed array', function (t) {
  s.on('/', function (req, res) {
    req.pipe(res)
    // Close the session if it's a HTTP/2 request. This is not representative of a true http/2 server that might keep the session open. But we need this to close the server in the tests.
    req.stream && req.stream.session && req.stream.session.close && req.stream.session.close()
  })

  var data = new Uint8Array([1, 2, 3])
  request(
    {
      uri: 'https://localhost:' + s.port,
      method: 'POST',
      body: data,
      encoding: null,
      strictSSL: false,
      protocolVersion: 'http2'
    },
    function (err, res, body) {
      t.error(err)
      t.deepEqual(Buffer.from(data), body)
      s.removeAllListeners('/')

      t.end()
    }
  )
})

tape('cleanup', function (t) {
  s.close(function () {
    t.end()
  })
})
