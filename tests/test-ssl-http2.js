'use strict'

// this also validates that for each configuration new Agent is created
// previously same Agent was re-used on passphrase change

var server = require('./server')
var request = require('../index')
var fs = require('fs')
var path = require('path')
var tape = require('tape')
var destroyable = require('server-destroy')

var caPath = path.resolve(__dirname, 'ssl/ca/ca.crt')
var ca = fs.readFileSync(caPath)
var clientPfx = fs.readFileSync(path.resolve(__dirname, 'ssl/ca/client.pfx'))
var clientKey = fs.readFileSync(path.resolve(__dirname, 'ssl/ca/client.key'))
var clientCert = fs.readFileSync(path.resolve(__dirname, 'ssl/ca/client.crt'))
var clientKeyEnc = fs.readFileSync(path.resolve(__dirname, 'ssl/ca/client-enc.key'))
var clientPassword = 'password'

var http2SecureServer = server.createHttp2Server({
  key: path.resolve(__dirname, 'ssl/ca/localhost.key'),
  cert: path.resolve(__dirname, 'ssl/ca/localhost.crt'),
  ca: caPath,
  requestCert: true,
  rejectUnauthorized: true
})

destroyable(http2SecureServer)

tape('setup', function (t) {
  http2SecureServer.on('/', function (req, res) {
    if (req.stream.session.socket.authorized) {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('authorized')
    } else {
      res.writeHead(401, { 'Content-Type': 'text/plain' })
      res.end('unauthorized')
    }
  })

  http2SecureServer.listen(0, function () {
    t.end()
  })
})

tape('key + cert', function (t) {
  request({
    url: http2SecureServer.url,
    ca: ca,
    key: clientKey,
    cert: clientCert,
    protocolVersion: 'http2'
  }, function (err, res, body) {
    t.equal(err, null)
    t.equal(body.toString(), 'authorized')
    t.end()
  })
})

tape('key + cert + passphrase', function (t) {
  request({
    url: http2SecureServer.url,
    ca: ca,
    key: clientKeyEnc,
    cert: clientCert,
    passphrase: clientPassword,
    protocolVersion: 'http2'
  }, function (err, res, body) {
    t.equal(err, null)
    t.equal(body.toString(), 'authorized')
    t.end()
  })
})

tape('key + cert + passphrase(invalid)', function (t) {
  request({
    url: http2SecureServer.url,
    ca: ca,
    key: clientKeyEnc,
    cert: clientCert,
    passphrase: 'invalidPassphrase',
    protocolVersion: 'http2'
  }, function (err, res, body) {
    t.ok(err)
    t.end()
  })
})

tape('pfx + passphrase', function (t) {
  request({
    url: http2SecureServer.url,
    ca: ca,
    pfx: clientPfx,
    passphrase: clientPassword,
    protocolVersion: 'http2'
  }, function (err, res, body) {
    t.equal(err, null)
    t.equal(body.toString(), 'authorized')
    t.end()
  })
})

tape('pfx + passphrase(invalid)', function (t) {
  request({
    url: http2SecureServer.url,
    ca: ca,
    pfx: clientPfx,
    passphrase: 'invalidPassphrase',
    protocolVersion: 'http2'
  }, function (err, res, body) {
    t.ok(err)
    t.end()
  })
})

tape('extraCA', function (t) {
  request({
    url: http2SecureServer.url,
    extraCA: ca,
    key: clientKey,
    cert: clientCert,
    protocolVersion: 'http2'
  }, function (err, res, body) {
    t.equal(err, null)
    t.equal(body.toString(), 'authorized')
    t.end()
  })
})

tape('ca + extraCA', function (t) {
  request({
    url: http2SecureServer.url,
    ca: ca,
    extraCA: '---INVALID CERT---', // make sure this won't affect options.ca
    key: clientKey,
    cert: clientCert,
    protocolVersion: 'http2'
  }, function (err, res, body) {
    t.equal(err, null)
    t.equal(body.toString(), 'authorized')
    t.end()
  })
})

tape('cleanup', function (t) {
  http2SecureServer.destroy(function () {
    t.end()
  })
})
