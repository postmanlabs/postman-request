/*
   * This function has been referenced from Node.js HTTPS Agent implementation
   * Ref: v20.15.0 https://github.com/nodejs/node/blob/6bf148e12b00a3ec596f4c123ec35445a48ab209/lib/https.js
   */
function getName (options) {
  let name = options.host || 'localhost'

  name += ':'
  if (options.port) { name += options.port }

  name += ':'
  if (options.localAddress) { name += options.localAddress }
  if (options.socketPath) { name += `:${options.socketPath}` }

  name += ':'
  if (options.ca) { name += options.ca }

  name += ':'
  if (options.extraCA) { name += options.extraCA }

  name += ':'
  if (options.cert) { name += options.cert }

  name += ':'
  if (options.clientCertEngine) { name += options.clientCertEngine }

  name += ':'
  if (options.ciphers) { name += options.ciphers }

  name += ':'
  if (options.key) { name += options.key }

  name += ':'
  if (options.pfx) { name += options.pfx }

  name += ':'
  if (options.rejectUnauthorized !== undefined) { name += options.rejectUnauthorized }

  name += ':'
  if (options.servername && options.servername !== options.host) { name += options.servername }

  name += ':'
  if (options.minVersion) { name += options.minVersion }

  name += ':'
  if (options.maxVersion) { name += options.maxVersion }

  name += ':'
  if (options.secureProtocol) { name += options.secureProtocol }

  name += ':'
  if (options.crl) { name += options.crl }

  name += ':'
  if (options.honorCipherOrder !== undefined) { name += options.honorCipherOrder }

  name += ':'
  if (options.ecdhCurve) { name += options.ecdhCurve }

  name += ':'
  if (options.dhparam) { name += options.dhparam }

  name += ':'
  if (options.secureOptions !== undefined) { name += options.secureOptions }

  name += ':'
  if (options.sessionIdContext) { name += options.sessionIdContext }

  name += ':'
  if (options.sigalgs) { name += JSON.stringify(options.sigalgs) }

  name += ':'
  if (options.privateKeyIdentifier) { name += options.privateKeyIdentifier }

  name += ':'
  if (options.privateKeyEngine) { name += options.privateKeyEngine }

    // Create new connection since previous connection cannot be reused since it will not emit secureConnect event which will not set the session data
  name += ':' + Boolean(options.verbose)

  return name
}

module.exports = {
  getName
}
