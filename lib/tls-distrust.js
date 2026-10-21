'use strict'

var crypto = require('crypto')

var distrustedCAs = require('./distrusted-cas')
var REVOKED_CA_SPKI_SHA256 = distrustedCAs.REVOKED_CA_SPKI_SHA256

// Node raises this code for a revoked certificate; it surfaces on the request's 'error' event the
// same way any other TLS failure does, and a connection with SSL verification turned off is
// unaffected because Node only enforces `checkServerIdentity` when `rejectUnauthorized` is on.
var ERROR_CODE = 'CERT_REVOKED'

// Real chains are 2 to 4 certificates; the cap bounds a malformed issuer chain.
var MAX_CHAIN_LENGTH = 16

var INSTALLED = Symbol.for('postman.tlsDenylist.installed')

// INC-139: distrust the compromised eMudhra intermediates for every outbound TLS connection.
//
// This mirrors postman-app's src/main/common/utils/tlsDenylist.js (postman-app#53068): we wrap
// `tls.connect` and inject a `checkServerIdentity` that rejects any verified chain containing a
// revoked CA, running it *before* the caller's own check (or Node's default). Wrapping
// `tls.connect` -- rather than the per-request options -- covers every transport uniformly:
// direct https, the ALPN/h2 auto agent, the proxy CONNECT tunnel, and the SOCKS agent all bottom
// out at `tls.connect`, so none of them can slip past, and a caller that supplies its own
// `checkServerIdentity` still gets the revocation check layered on top.
//
// NOT covered: anything that opens TLS outside Node's `tls` module (e.g. a native module with its
// own OpenSSL), and child processes / worker threads -- propagating the hook to those is the
// embedding product's responsibility, not this request library's.

// SHA-256 (base64) of the certificate's DER SubjectPublicKeyInfo.
// @param {Buffer|String} certificate - DER or PEM
function spkiSha256 (certificate) {
  var spki = new crypto.X509Certificate(certificate).publicKey.export({ type: 'spki', format: 'der' })

  return crypto.createHash('sha256').update(spki).digest('base64')
}

// @param {Array<Buffer|String>} chain - DER or PEM certificates, leaf first
// @param {Map<String, String>} [denylist] - SPKI sha256 (base64) -> CA name
// @returns {String|null} name of the first revoked CA in the chain
function findRevokedCa (chain, denylist) {
  denylist = denylist || REVOKED_CA_SPKI_SHA256

  for (var i = 0; i < chain.length; i++) {
    var hash

    try {
      hash = spkiSha256(chain[i])
    } catch (e) {
      // a certificate this parser can't read is left to the normal verifier
      continue
    }

    if (denylist.has(hash)) {
      return denylist.get(hash) || null
    }
  }

  return null
}

// Walks `issuerCertificate` up to the self-signed root, collecting each cert's `dataKey` (the raw
// DER). The root's issuerCertificate points back at itself, so `seen` stops the walk.
function collectChain (certificate, issuerKey, dataKey) {
  var chain = []
  var seen = new Set()

  for (
    var current = certificate;
    current && !seen.has(current) && chain.length < MAX_CHAIN_LENGTH;
    current = current[issuerKey]
  ) {
    seen.add(current)

    if (current[dataKey]) {
      chain.push(current[dataKey])
    }
  }

  return chain
}

function revokedCaError (caName) {
  var error = new Error('The certificate chain includes "' + caName +
    '", a certificate authority revoked because its private key was compromised')

  error.code = ERROR_CODE

  return error
}

function isObject (arg) {
  return arg !== null && typeof arg === 'object'
}

// Returns a copy of the `tls.connect` `args` with a `checkServerIdentity` that rejects revoked CAs
// before running the caller's own check (or Node's default).
//
// Node takes options from `args[0]` and merges `args[1]`, or else `args[2]`, over them, so each of
// those objects gets the wrapper and the caller's check (the last one merged) is preserved.
function withDenylistCheck (args, tls, denylist) {
  var optionsIndexes = [0, isObject(args[1]) ? 1 : 2].filter(function (index) {
    return isObject(args[index])
  })

  var callerCheck = optionsIndexes.reduce(function (check, index) {
    return args[index].checkServerIdentity || check
  }, undefined)

  function checkServerIdentity (hostname, cert) {
    var caName = findRevokedCa(collectChain(cert, 'issuerCertificate', 'raw'), denylist)

    if (caName) {
      return revokedCaError(caName)
    }

    return (callerCheck || tls.checkServerIdentity)(hostname, cert)
  }

  if (optionsIndexes.length) {
    return args.map(function (arg, index) {
      return optionsIndexes.indexOf(index) !== -1
        ? Object.assign({}, arg, { checkServerIdentity: checkServerIdentity })
        : arg
    })
  }

  // (port[, host][, callback]) and (path[, callback]): an options object in the slot before the
  // callback is the one Node merges.
  var next = args.slice()
  var callbackIndex = next.findIndex(function (arg) { return typeof arg === 'function' })

  next.splice(callbackIndex === -1 ? next.length : callbackIndex, 0, {
    checkServerIdentity: checkServerIdentity
  })

  return next
}

// Wraps `tls.connect` for the whole process so that every Node TLS client rejects a chain through
// a revoked CA. Idempotent: safe to call on every request and to coexist with the same fix already
// installed in the host process.
function install () {
  var tls = require('tls')

  // No Node TLS stack (e.g. the browser build, where requests go through XHR): nothing to harden.
  if (!tls || typeof tls.connect !== 'function') {
    return
  }

  if (tls.connect[INSTALLED]) {
    return
  }

  var connect = tls.connect

  function connectWithDenylist () {
    var args = Array.prototype.slice.call(arguments)

    return connect.apply(this, withDenylistCheck(args, tls, REVOKED_CA_SPKI_SHA256))
  }

  connectWithDenylist[INSTALLED] = true
  tls.connect = connectWithDenylist
}

module.exports = {
  install: install,
  findRevokedCa: findRevokedCa,
  withDenylistCheck: withDenylistCheck,
  REVOKED_CA_SPKI_SHA256: REVOKED_CA_SPKI_SHA256,
  ERROR_CODE: ERROR_CODE
}
