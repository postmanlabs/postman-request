const {constants = {}} = require('http2')

// Referenced from https://github.com/nodejs/node/blob/0bf200b49a9a6eacdea6d5e5939cc2466506d532/lib/internal/http2/util.js#L107
const kValidPseudoHeaders = new Set([
  constants.HTTP2_HEADER_STATUS,
  constants.HTTP2_HEADER_METHOD,
  constants.HTTP2_HEADER_AUTHORITY,
  constants.HTTP2_HEADER_SCHEME,
  constants.HTTP2_HEADER_PATH
])

// Referenced from https://github.com/nodejs/node/blob/0bf200b49a9a6eacdea6d5e5939cc2466506d532/lib/internal/http2/util.js#L573
function assertValidPseudoHeader (header) {
  if (!kValidPseudoHeaders.has(header)) {
    throw new Error('Invalid PseudoHeader ' + header)
  }
}

// Referenced from https://github.com/nodejs/node/blob/0bf200b49a9a6eacdea6d5e5939cc2466506d532/lib/_http_common.js#L206
const tokenRegExp = /^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/
function checkIsHttpToken (token) {
  return RegExp(tokenRegExp).exec(token) !== null
}

module.exports = {
  assertValidPseudoHeader,
  checkIsHttpToken
}
