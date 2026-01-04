'use strict'

// this also validates that for each configuration new Agent is created
// previously same Agent was re-used on passphrase change

const server = require('./server')
const request = require('../index')
const fs = require('fs')
const path = require('path')
const tape = require('tape')

const caPath = path.resolve(__dirname, 'ssl/ca/ca.crt')
const ca = fs.readFileSync(caPath)
const clientPfx = fs.readFileSync(path.resolve(__dirname, 'ssl/ca/client.pfx'))
const clientKey = fs.readFileSync(path.resolve(__dirname, 'ssl/ca/client.key'))
const clientCert = fs.readFileSync(path.resolve(__dirname, 'ssl/ca/client.crt'))
const clientKeyEnc = fs.readFileSync(path.resolve(__dirname, 'ssl/ca/client-enc.key'))
const clientPassword = 'password'

const sslServer = server.createSSLServer({
  key: path.resolve(__dirname, 'ssl/ca/localhost.key'),
  cert: path.resolve(__dirname, 'ssl/ca/localhost.crt'),
  ca: caPath,
  requestCert: true,
  rejectUnauthorized: true
})

tape('setup', function (t) {
  sslServer.on('/', function (req, res) {
    if (req.client.authorized) {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('authorized')
    } else {
      res.writeHead(401, { 'Content-Type': 'text/plain' })
      res.end('unauthorized')
    }
  })

  sslServer.listen(0, function () {
    t.end()
  })
})

tape('key + cert', function (t) {
  request({
    url: sslServer.url,
    ca,
    key: clientKey,
    cert: clientCert
  }, function (err, res, body) {
    t.equal(err, null)
    t.equal(body.toString(), 'authorized')
    t.end()
  })
})

tape('key + cert + passphrase', function (t) {
  request({
    url: sslServer.url,
    ca,
    key: clientKeyEnc,
    cert: clientCert,
    passphrase: clientPassword
  }, function (err, res, body) {
    t.equal(err, null)
    t.equal(body.toString(), 'authorized')
    t.end()
  })
})

tape('key + cert + passphrase(invalid)', function (t) {
  request({
    url: sslServer.url,
    ca,
    key: clientKeyEnc,
    cert: clientCert,
    passphrase: 'invalidPassphrase'
  }, function (err, res, body) {
    t.ok(err)
    t.end()
  })
})

tape('pfx + passphrase', function (t) {
  request({
    url: sslServer.url,
    ca,
    pfx: clientPfx,
    passphrase: clientPassword
  }, function (err, res, body) {
    t.equal(err, null)
    t.equal(body.toString(), 'authorized')
    t.end()
  })
})

tape('pfx + passphrase(invalid)', function (t) {
  request({
    url: sslServer.url,
    ca,
    pfx: clientPfx,
    passphrase: 'invalidPassphrase'
  }, function (err, res, body) {
    t.ok(err)
    t.end()
  })
})

tape('extraCA', function (t) {
  request({
    url: sslServer.url,
    extraCA: ca,
    key: clientKey,
    cert: clientCert
  }, function (err, res, body) {
    t.equal(err, null)
    t.equal(body.toString(), 'authorized')
    t.end()
  })
})

tape('ca + extraCA', function (t) {
  request({
    url: sslServer.url,
    ca,
    extraCA: '---INVALID CERT---', // make sure this won't affect options.ca
    key: clientKey,
    cert: clientCert
  }, function (err, res, body) {
    t.equal(err, null)
    t.equal(body.toString(), 'authorized')
    t.end()
  })
})

tape('cleanup', function (t) {
  sslServer.close(function () {
    t.end()
  })
})
