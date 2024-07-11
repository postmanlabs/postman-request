var server = require('./server')
var assert = require('assert')
var request = require('../index')
var tape = require('tape')
var http = require('http')
var destroyable = require('server-destroy')

var plainServer = server.createServer()
var httpsServer = server.createSSLServer()
var http2Server = server.createHttp2Server()

destroyable(plainServer)
destroyable(httpsServer)
destroyable(http2Server)

tape('setup', function (t) {
  plainServer.listen(0, function () {
    plainServer.on('/', function (req, res) {
      res.writeHead(200)
      res.end('plain')
    })
    plainServer.on('/redir', function (req, res) {
      res.writeHead(301, { 'location': 'http://localhost:' + plainServer.port + '/' })
      res.end()
    })
    plainServer.on('/redir/https', function (req, res) {
      res.writeHead(301, { 'location': 'https://localhost:' + httpsServer.port + '/' })
      res.end()
    })

    plainServer.on('/redir/http2', function (req, res) {
      res.writeHead(301, { 'location': 'https://localhost:' + http2Server.port + '/' })
      res.end()
    })

    httpsServer.listen(0, function () {
      httpsServer.on('/', function (req, res) {
        res.writeHead(200)
        res.end('https')
      })
      httpsServer.on('/redir', function (req, res) {
        res.writeHead(301, { 'location': 'http://localhost:' + plainServer.port + '/' })
        res.end()
      })
      httpsServer.on('/redir/https', function (req, res) {
        res.writeHead(301, { 'location': 'https://localhost:' + httpsServer.port + '/' })
        res.end()
      })

      httpsServer.on('/redir/http2', function (req, res) {
        res.writeHead(301, { 'location': 'https://localhost:' + http2Server.port + '/' })
        res.end()
      })

      http2Server.listen(0, function () {
        http2Server.on('/', function (req, res) {
          res.writeHead(200)
          res.end('http2')
        })
        http2Server.on('/redir', function (req, res) {
          res.writeHead(301, { 'location': 'http://localhost:' + plainServer.port + '/' })
          res.end()
        })
        http2Server.on('/redir/https', function (req, res) {
          res.writeHead(301, { 'location': 'https://localhost:' + httpsServer.port + '/' })
          res.end()
        })

        http2Server.on('/redir/http2', function (req, res) {
          res.writeHead(301, { 'location': 'https://localhost:' + http2Server.port + '/' })
          res.end()
        })
        t.end()
      })
    })
  })
})

tape('HTTP to HTTP2', function (t) {
  var options = { strictSSL: false }
  request('http://localhost:' + plainServer.port + '/redir/http2', options, function (err, res, body) {
    t.equal(err, null)
    t.equal(body, 'http2')
    t.equal(res.statusCode, 200)
    t.equal(res.httpVersion, '2.0')
    t.end()
  })
})

tape('HTTPS to HTTP2', function (t) {
  var options = { strictSSL: false }
  request('https://localhost:' + httpsServer.port + '/redir/http2', options, function (err, res, body) {
    t.equal(err, null)
    t.equal(body, 'http2')
    t.equal(res.statusCode, 200)
    t.equal(res.httpVersion, '2.0')
    t.end()
  })
})

tape('HTTP2 to HTTP', function (t) {
  var options = { strictSSL: false }
  request('https://localhost:' + http2Server.port + '/redir', options, function (err, res, body) {
    t.equal(err, null)
    t.equal(body, 'plain')
    t.equal(res.statusCode, 200)
    t.equal(res.httpVersion, '1.1')
    t.end()
  })
})

tape('HTTP2 to HTTPS', function (t) {
  var options = { strictSSL: false }
  request('https://localhost:' + http2Server.port + '/redir/https', options, function (err, res, body) {
    t.equal(err, null)
    t.equal(body, 'https')
    t.equal(res.httpVersion, '1.1')
    t.end()
  })
})

tape('cleanup', function (t) {
  plainServer.destroy(() => {
    httpsServer.destroy(() => {
      http2Server.destroy(() => {
        t.end()
      })
    })
  })
})
