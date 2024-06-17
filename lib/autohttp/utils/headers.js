const {constants} = require('http2')
const kValidPseudoHeaders = new Set([
  constants.HTTP2_HEADER_STATUS,
  constants.HTTP2_HEADER_METHOD,
  constants.HTTP2_HEADER_AUTHORITY,
  constants.HTTP2_HEADER_SCHEME,
  constants.HTTP2_HEADER_PATH
])

function assertValidPseudoHeader (header) {
  if (!kValidPseudoHeaders.has(header)) {
    throw new Error('Invalid PseudoHeader ' + header)
  }
}

const tokenRegExp = /^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/
function checkIsHttpToken (token) {
  return RegExp(tokenRegExp).exec(token) !== null
}

module.exports = {
  assertValidPseudoHeader,
  checkIsHttpToken
}
