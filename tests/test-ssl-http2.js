'use strict'

// this also validates that for each configuration new Agent is created
// previously same Agent was re-used on passphrase change

const server = require('./server')
const request = require('../index')
const fs = require('fs')
const path = require('path')
const tape = require('tape')
const destroyable = require('server-destroy')

const caPath = path.resolve(__dirname, 'ssl/ca/ca.crt')
const ca = fs.readFileSync(caPath)
const clientPfx = fs.readFileSync(path.resolve(__dirname, 'ssl/ca/client.pfx'))
const clientKey = fs.readFileSync(path.resolve(__dirname, 'ssl/ca/client.key'))
const clientCert = fs.readFileSync(path.resolve(__dirname, 'ssl/ca/client.crt'))
const clientKeyEnc = fs.readFileSync(path.resolve(__dirname, 'ssl/ca/client-enc.key'))
const clientPassword = 'password'

const http2SecureServer = server.createHttp2Server({
  key: path.resolve(__dirname, 'ssl/ca/localhost.key'),
  cert: path.resolve(__dirname, 'ssl/ca/localhost.crt'),
  ca: caPath,
  requestCert: true,
  rejectUnauthorized: true
})

const httpsServer = server.createSSLServer({
  key: path.resolve(__dirname, 'ssl/ca/localhost.key'),
  cert: path.resolve(__dirname, 'ssl/ca/localhost.crt'),
  ca: caPath,
  rejectUnauthorized: true
})

destroyable(http2SecureServer)
destroyable(httpsServer)

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

  httpsServer.on('/', function (req, res) {
    if (req.connection.authorized) {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('authorized')
    } else {
      res.writeHead(401, { 'Content-Type': 'text/plain' })
      res.end('unauthorized')
    }
  })

  http2SecureServer.listen(0, function () {
    httpsServer.listen(0, function () {
      t.end()
    })
  })
})

tape('key + cert', function (t) {
  request({
    url: http2SecureServer.url,
    ca,
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
    ca,
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
    ca,
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
    ca,
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
    ca,
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
    ca,
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

tape('http2 -> https', function (t) {
  request({
    url: httpsServer.url,
    ca,
    key: clientKey,
    cert: clientCert,
    protocolVersion: 'http2'
  }, function (err, res, body) {
    t.notEqual(err, null)
    t.equal(err.code, 'ERR_HTTP2_ERROR')
    t.equal(err.errno, -505)

    t.end()
  })
})

tape('cleanup', function (t) {
  http2SecureServer.destroy(function () {
    httpsServer.destroy(function () {
      t.end()
    })
  })
})
