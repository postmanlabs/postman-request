'use strict'

// INC-139: unit tests for the eMudhra CA distrust filter. These are offline -- they build the
// detailed peer-certificate shape that `socket.getPeerCertificate(true)` produces from embedded
// PEMs, so no network or test server is involved.

var crypto = require('crypto')
var tls = require('tls')
var tape = require('tape')

var tlsDistrust = require('../lib/tls-distrust')
var install = tlsDistrust.install
var findRevokedCa = tlsDistrust.findRevokedCa
var withDenylistCheck = tlsDistrust.withDenylistCheck
var REVOKED_CA_SPKI_SHA256 = tlsDistrust.REVOKED_CA_SPKI_SHA256
var ERROR_CODE = tlsDistrust.ERROR_CODE

// [{ name, issuer, pem }], each compromised CA once per issuer (emSign + the AAA cross-sign)
var revokedCerts = require('./fixtures/inc-139-emudhra-cas.json')

var HOSTNAME = 'example.test'

// a trusted root already in Node's store, used as a clean (non-revoked) link in a chain
var cleanPem = tls.rootCertificates.find(function (pem) {
  return (/CN=ISRG Root X1/).test(new crypto.X509Certificate(pem).subject)
})

// shape of socket.getPeerCertificate(true): the root's issuerCertificate points back at itself
function chainObj () {
  var pems = Array.prototype.slice.call(arguments)
  var certs = pems.map(function (pem) { return { raw: new crypto.X509Certificate(pem).raw } })

  certs.forEach(function (cert, i) { cert.issuerCertificate = certs[i + 1] || cert })

  return certs[0]
}

tape('tls-distrust: denylist has exactly the 8 compromised intermediates', function (t) {
  t.equal(REVOKED_CA_SPKI_SHA256.size, 8)
  t.end()
})

tape('tls-distrust: findRevokedCa catches every compromised cert (both issuers)', function (t) {
  revokedCerts.forEach(function (ca) {
    // findRevokedCa accepts PEM directly; a clean root ahead of it must not mask the match
    t.equal(findRevokedCa([cleanPem, ca.pem]), ca.name, ca.name + ' issued by ' + ca.issuer)
  })
  t.end()
})

tape('tls-distrust: findRevokedCa passes an unrelated chain', function (t) {
  t.equal(findRevokedCa([cleanPem]), null)
  t.end()
})

tape('tls-distrust: findRevokedCa skips an unparseable certificate and keeps scanning', function (t) {
  var garbage = Buffer.from('not a certificate')

  t.equal(findRevokedCa([garbage]), null, 'unparseable alone is ignored')
  t.equal(findRevokedCa([garbage, revokedCerts[0].pem]), revokedCerts[0].name, 'still finds a revoked CA after it')
  t.end()
})

tape('tls-distrust: withDenylistCheck injects a check that blocks a revoked chain with CERT_REVOKED', function (t) {
  var patched = withDenylistCheck([{}], tls, REVOKED_CA_SPKI_SHA256)
  var bad = revokedCerts[0]
  var error = patched[0].checkServerIdentity(HOSTNAME, chainObj(cleanPem, bad.pem))

  t.ok(error instanceof Error, 'returns an Error')
  t.equal(error.code, ERROR_CODE)
  t.ok(error.message.indexOf(bad.name) !== -1, 'message names the revoked CA')
  t.end()
})

tape('tls-distrust: withDenylistCheck defers to the caller check on a clean chain', function (t) {
  var called = false
  var sentinel = new Error('caller check ran')
  var callerCheck = function () { called = true; return sentinel }

  var patched = withDenylistCheck([{ checkServerIdentity: callerCheck }], tls, REVOKED_CA_SPKI_SHA256)
  var result = patched[0].checkServerIdentity(HOSTNAME, chainObj(cleanPem))

  t.ok(called, 'caller check was invoked')
  t.equal(result, sentinel, 'caller check result is returned')
  t.end()
})

tape('tls-distrust: revocation runs before the caller check (caller cannot re-trust a revoked CA)', function (t) {
  var callerCheck = function () { throw new Error('caller check should not run for a revoked chain') }

  var patched = withDenylistCheck([{ checkServerIdentity: callerCheck }], tls, REVOKED_CA_SPKI_SHA256)
  var error = patched[0].checkServerIdentity(HOSTNAME, chainObj(cleanPem, revokedCerts[0].pem))

  t.equal(error.code, ERROR_CODE)
  t.end()
})

tape('tls-distrust: withDenylistCheck adds an options object for (port, host) and (port, cb) forms', function (t) {
  var noOptions = withDenylistCheck([443, 'host.test'], tls, REVOKED_CA_SPKI_SHA256)
  t.equal(noOptions.length, 3, 'appends an options object')
  t.equal(typeof noOptions[2].checkServerIdentity, 'function')

  var cb = function () {}
  var beforeCb = withDenylistCheck([443, cb], tls, REVOKED_CA_SPKI_SHA256)
  t.equal(typeof beforeCb[1].checkServerIdentity, 'function', 'inserts options before the callback')
  t.equal(beforeCb[2], cb, 'callback stays last')
  t.end()
})

tape('tls-distrust: install wraps tls.connect and is idempotent', function (t) {
  var original = tls.connect
  var INSTALLED = Symbol.for('postman.tlsDenylist.installed')

  install()
  var wrapped = tls.connect
  t.notEqual(wrapped, original, 'tls.connect was replaced')
  t.ok(wrapped[INSTALLED], 'marked installed')

  install()
  t.equal(tls.connect, wrapped, 'second install did not re-wrap')

  tls.connect = original
  t.end()
})
