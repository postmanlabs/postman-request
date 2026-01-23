const request = require('../index').defaults({ strictSSL: false })
const http2 = require('http2')
const zlib = require('zlib')
const tape = require('tape')
const url = require('url')
const path = require('path')
const fs = require('fs')
const destroyable = require('server-destroy')

const CHAR = 'X'

// request path to this server should be of the form '/<bytes>?gzip=[true/false]'
// response from the server will have size of <bytes> from request path
const server = http2.createSecureServer(
  {
    key: fs.readFileSync(path.join(__dirname, 'ssl', 'ca', 'localhost.key')),
    cert: fs.readFileSync(path.join(__dirname, 'ssl', 'ca', 'localhost.crt'))
  }
  , function (req, res) {
    /* eslint-disable-next-line n/no-deprecated-api */
    const parsedUrl = url.parse(req.url, { parseQueryString: true })
    const bytes = parseInt(parsedUrl.pathname.substring(1)) || 0
    const gzip = parsedUrl.query.gzip
    const data = Buffer.from(CHAR.repeat(bytes))

    res.setHeader('Content-Type', 'text/plain')

    if (gzip === 'true') {
      zlib.gzip(data, function (err, compressedData) {
        if (err) {
          res.writeHead(500)
          res.end()
          return
        }

        res.setHeader('Content-Encoding', 'gzip')
        res.setHeader('Content-Length', compressedData.length)
        res.writeHead(200)
        res.write(compressedData)
        res.end()
      })
    } else {
      res.setHeader('Content-Length', data.length)
      res.writeHead(200)
      res.write(data)
      res.end()
    }
  })

destroyable(server)

tape('setup', function (t) {
  server.listen(0, function () {
    server.port = this.address().port
    server.url = 'https://localhost:' + server.port
    t.end()
  })
})

tape('response < maxResponseSize', function (t) {
  const options = {
    method: 'GET',
    uri: server.url + '/50',
    maxResponseSize: 100,
    protocolVersion: 'http2'
  }

  request(options, function (err, res, body) {
    t.equal(err, null)
    t.ok(body, 'Should receive body')
    t.ok(body.length < options.maxResponseSize)
    t.end()
  })
})

tape('response = maxResponseSize', function (t) {
  const options = {
    method: 'GET',
    uri: server.url + '/100',
    maxResponseSize: 100,
    protocolVersion: 'http2'
  }

  request(options, function (err, res, body) {
    t.equal(err, null)
    t.ok(body, 'Should receive body')
    t.ok(body.length === options.maxResponseSize)
    t.end()
  })
})

tape('response > maxResponseSize', function (t) {
  const options = {
    method: 'GET',
    uri: server.url + '/200',
    maxResponseSize: 100,
    protocolVersion: 'http2'
  }

  request(options, function (err, res, body) {
    t.notEqual(err, null)
    t.equal(typeof err, 'object')
    t.equal(err.name, 'Error')
    t.equal(err.message, 'Maximum response size reached')
    t.end()
  })
})

tape('extracted gzip response > maxResponseSize but content-length < maxResponseSize', function (t) {
  const options = {
    method: 'GET',
    uri: server.url + '/500?gzip=true', // for 500 bytes gzip response, content-length will be around 30
    maxResponseSize: 490,
    gzip: true,
    protocolVersion: 'http2'
  }

  request(options, function (err, res, body) {
    t.notEqual(err, null)
    t.equal(typeof err, 'object')
    t.equal(err.name, 'Error')
    t.equal(err.message, 'Maximum response size reached')
    t.end()
  })
})

tape('extracted gzip response < maxResponseSize', function (t) {
  const options = {
    method: 'GET',
    uri: server.url + '/100?gzip=true',
    maxResponseSize: 200,
    gzip: true,
    protocolVersion: 'http2'
  }

  request(options, function (err, res, body) {
    t.equal(err, null)
    t.ok(body, 'Should receive body')
    t.ok(body.length < options.maxResponseSize)
    t.end()
  })
})

tape('cleanup', function (t) {
  server.destroy(function () {
    t.end()
  })
})
