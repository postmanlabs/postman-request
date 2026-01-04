'use strict'

const request = require('../index')
const zlib = require('zlib')
const tape = require('tape')
const Buffer = require('safe-buffer').Buffer
const server = require('./server')

const testContent = 'compressible response content.\n'
const testContentBrotli = zlib.brotliCompressSync(testContent)
let testContentBig
let testContentBigBrotli

const s = server.createHttp2Server()
const sessions = []
s.on('session', (session) => {
  sessions.push(session)
})

function requestHandler (req, res) {
  res.statusCode = 200

  res.setHeader('Content-Type', 'text/plain')

  if (req.method === 'HEAD') {
    res.writeHead(200, { 'Content-Encoding': 'br' })
    res.end()
    return
  }
  if (req.headers.code) {
    res.writeHead(req.headers.code, {
      'Content-Encoding': 'br',
      code: req.headers.code
    })
    res.end()
    return
  }
  const session = req.stream.session

  res.stream.on('close', () => {
    session.close()
  })

  if (/\bbr\b/i.test(req.headers['accept-encoding'])) {
    res.setHeader('Content-Encoding', 'br')
    if (req.url === '/error') {
      res.writeHead(200)
      // send plaintext instead of br (should cause an error for the client)
      res.end(testContent)
    } else if (req.url === '/chunks') {
      res.writeHead(200)
      res.write(Buffer.from(testContentBigBrotli.slice(0, 4096)))
      setTimeout(function () {
        res.end(Buffer.from(testContentBigBrotli.slice(4096)))
      }, 10)
    } else {
      res.end(testContentBrotli)
    }
  } else {
    res.end(testContent)
  }
}

tape('setup', function (t) {
  // Need big compressed content to be large enough to chunk into brotli blocks.
  // Want it to be deterministic to ensure test is reliable.
  // Generate pseudo-random printable ASCII characters using MINSTD
  const a = 48271
  const m = 0x7fffffff
  let x = 1
  testContentBig = Buffer.alloc(10240)
  for (let i = 0; i < testContentBig.length; ++i) {
    x = (a * x) & m
    // Printable ASCII range from 32-126, inclusive
    testContentBig[i] = (x % 95) + 32
  }

  testContentBigBrotli = zlib.brotliCompressSync(Buffer.from(testContentBig))

  s.on('/foo', requestHandler)
  s.on('/error', requestHandler)
  s.on('/chunks', requestHandler)
  s.listen(0, function () {
    t.end()
  })
})

tape('transparently supports brotli decoding to callbacks', function (t) {
  const options = {
    url: s.url + '/foo',
    brotli: true,
    protocolVersion: 'http2',
    strictSSL: false
  }
  request.get(options, function (err, res, body) {
    t.equal(err, null)
    t.equal(res.headers['content-encoding'], 'br')
    t.equal(body, testContent)
    t.end()
  })
})

tape('transparently supports brotli decoding to pipes', function (t) {
  const options = {
    url: s.url + '/foo',
    brotli: true,
    protocolVersion: 'http2',
    strictSSL: false
  }
  const chunks = []
  request
    .get(options)
    .on('data', function (chunk) {
      chunks.push(chunk)
    })
    .on('end', function () {
      t.equal(Buffer.concat(chunks).toString(), testContent)
      t.end()
    })
    .on('error', function (err) {
      t.fail(err)
    })
})

tape(
  'does not request brotli if user specifies Accepted-Encodings',
  function (t) {
    const headers = { 'Accept-Encoding': null }
    const options = {
      url: s.url + '/foo',
      headers,
      brotli: true,
      protocolVersion: 'http2',
      strictSSL: false
    }
    request.get(options, function (err, res, body) {
      t.equal(err, null)
      t.equal(res.headers['content-encoding'], undefined)
      t.equal(body, testContent)
      t.end()
    })
  }
)

tape('does not decode user-requested encoding by default', function (t) {
  const headers = { 'Accept-Encoding': 'br' }
  const options = {
    url: s.url + '/foo',
    headers,
    protocolVersion: 'http2',
    strictSSL: false
  }
  request.get(options, function (err, res, body) {
    t.equal(err, null)
    t.equal(res.headers['content-encoding'], 'br')
    t.equal(body, testContentBrotli.toString())
    t.end()
  })
})

tape('does not decode brotli encoding when "gzip" option is set', function (t) {
  const headers = { 'Accept-Encoding': 'br' }
  const options = {
    url: s.url + '/foo',
    headers,
    gzip: true,
    protocolVersion: 'http2',
    strictSSL: false
  }
  request.get(options, function (err, res, body) {
    t.equal(err, null)
    t.equal(res.headers['content-encoding'], 'br')
    t.equal(body, testContentBrotli.toString())
    t.end()
  })
})

tape('supports character encoding with brotli encoding', function (t) {
  const headers = { 'Accept-Encoding': 'br' }
  const options = {
    url: s.url + '/foo',
    headers,
    brotli: true,
    encoding: 'utf8',
    protocolVersion: 'http2',
    strictSSL: false
  }
  const strings = []
  request
    .get(options)
    .on('data', function (string) {
      t.equal(typeof string, 'string')
      strings.push(string)
    })
    .on('end', function () {
      t.equal(strings.join(''), testContent)
      t.end()
    })
    .on('error', function (err) {
      t.fail(err)
    })
})

tape('transparently supports brotli error to callbacks', function (t) {
  const options = {
    url: s.url + '/error',
    brotli: true,
    protocolVersion: 'http2',
    strictSSL: false
  }
  request.get(options, function (err, res, body) {
    t.ok(err)
    t.equal(res, undefined)
    t.equal(body, undefined)
    t.end()
  })
})

tape('transparently supports brotli error to pipes', function (t) {
  const options = {
    url: s.url + '/error',
    brotli: true,
    protocolVersion: 'http2',
    strictSSL: false
  }
  request
    .get(options)
    .on('data', function (chunk) {
      t.fail('Should not receive data event')
    })
    .on('end', function () {
      t.fail('Should not receive end event')
    })
    .on('error', function (err) {
      t.ok(err)
      t.end()
    })
})

tape('pause when streaming from a brotli request object', function (t) {
  const options = {
    url: s.url + '/chunks',
    brotli: true,
    protocolVersion: 'http2',
    strictSSL: false
  }
  request.get(options, function (err, res, body) {
    t.equal(err, null)
    t.equal(body, testContentBig.toString())
    t.end()
  })
})

tape('pause before streaming from a brotli request object', function (t) {
  let paused = true
  const options = {
    url: s.url + '/foo',
    brotli: true,
    protocolVersion: 'http2',
    strictSSL: false
  }
  const r = request.get(options)
  r.pause()
  r.on('data', function (data) {
    t.notOk(paused, 'Only receive data when not paused')
    t.equal(data.toString(), testContent)
  })
  r.on('end', t.end.bind(t))

  setTimeout(function () {
    paused = false
    r.resume()
  }, 100)
})

// Code works when making requests to actual servers, but our test implementation of server is not working as expected
tape('do not try to pipe HEAD request responses', function (t) {
  const options = {
    method: 'HEAD',
    url: s.url + '/foo',
    brotli: true,
    protocolVersion: 'http2',
    strictSSL: false
  }

  request(options, function (err, res, body) {
    t.equal(err, null)
    t.equal(body, '')
    t.end()
  })
})

tape('do not try to pipe responses with no body', function (t) {
  const options = {
    url: s.url + '/foo',
    brotli: true,
    protocolVersion: 'http2',
    strictSSL: false
  }

  // skip 105 on Node >= v10
  const statusCodes =
    process.version.split('.')[0].slice(1) >= 10 ? [204, 304] : [105, 204, 304];

  (function next (index) {
    if (index === statusCodes.length) {
      t.end()
      return
    }
    options.headers = { code: statusCodes[index] }
    request.post(options, function (err, res, body) {
      t.equal(err, null)
      t.equal(res.headers.code, statusCodes[index].toString())
      t.equal(body, '')
      next(++index)
    })
  })(0)
})

tape('cleanup', function (t) {
  sessions.forEach(session => {
    session.close()
  })
  s.close(function () {
    t.end()
  })
})
