const url = require('url')
const EMPTY = ''
const ZERO = '0'
const PERCENT = '%'
const STRING = 'string'
const AMPERSAND = '&'
const EQUALS = '='
const QUESTION_MARK = '?'

/**
 * Percent encode a character with given code.
 *
 * @param {Number} c - character code of the character to encode
 * @returns {String} - percent encoding of given character
 */
const percentEncode = function (c) {
  let hex = c.toString(16).toUpperCase()
  hex.length === 1 && (hex = ZERO + hex)
  return PERCENT + hex
}

/**
 * Checks if character with given code is valid hexadecimal digit or not.
 *
 * @param {Number} byte
 * @returns {Boolean}
 */
const isPreEncodedCharacter = function (byte) {
  return (byte >= 0x30 && byte <= 0x39) || // 0-9
    (byte >= 0x41 && byte <= 0x46) || // A-F
    (byte >= 0x61 && byte <= 0x66) // a-f
}

/**
 * Checks if character at given index in the buffer is already percent encoded or not.
 *
 * @param {Buffer} buffer
 * @param {Number} i
 * @returns {Boolean}
 */
const isPreEncoded = function (buffer, i) {
  // If it is % check next two bytes for percent encode characters
  // looking for pattern %00 - %FF
  return (buffer[i] === 0x25 &&
    (isPreEncodedCharacter(buffer[i + 1]) &&
    isPreEncodedCharacter(buffer[i + 2]))
  )
}

/**
 * Checks whether given character should be percent encoded or not for fixture.
 *
 * @param {Number} byte
 * @returns {Boolean}
 */
const charactersToPercentEncode = function (byte) {
  return (byte < 0x23 || byte > 0x7E || // Below # and after ~
    byte === 0x3C || byte === 0x3E || // > and <
    byte === 0x28 || byte === 0x29 || // ( and )
    byte === 0x25 || // %
    byte === 0x27 || // '
    byte === 0x2A // *
  )
}

/**
 * Percent encode a query string according to RFC 3986.
 * Note: This function is supposed to be used on top of node's inbuilt url encoding
 *       to solve issue https://github.com/nodejs/node/issues/8321
 *
 * @param {String} value
 * @returns {String}
 */
const encode = function (value) {
  if (!value) { return EMPTY }

  const buffer = Buffer.from(value)
  let ret = EMPTY
  let i
  let ii

  for (i = 0, ii = buffer.length; i < ii; ++i) {
    if (charactersToPercentEncode(buffer[i]) && !isPreEncoded(buffer, i)) {
      ret += percentEncode(buffer[i])
    } else {
      ret += String.fromCodePoint(buffer[i]) // Only works in ES6 (available in Node v4+)
    }
  }

  return ret
}

/**
 * Parses a query string into an array, preserving parameter values
 *
 * @param string
 * @returns {*}
 */
const parse = function (string) {
  let parts
  if (typeof string === STRING) { // eslint-disable-line valid-typeof
    parts = string.split(AMPERSAND)
    return parts.map(function (param, idx) {
      if (param === EMPTY && idx !== (parts.length - 1)) {
        return { key: null, value: null }
      }

      const index = (typeof param === STRING) ? param.indexOf(EQUALS) : -1 // eslint-disable-line valid-typeof
      const paramObj = {}

      // this means that there was no value for this key (not even blank, so we store this info) and the value is set
      // to null
      if (index < 0) {
        paramObj.key = param.substr(0, param.length)
        paramObj.value = null
      } else {
        paramObj.key = param.substr(0, index)
        paramObj.value = param.substr(index + 1)
      }

      return paramObj
    })
  }
  return []
}

/**
 * Stringifies a query string, from an array of parameters
 *
 * @param parameters
 * @returns {string}
 */
const stringify = function (parameters) {
  return parameters
    ? parameters.map(function (param) {
      let key = param.key
      const value = param.value

      if (value === undefined) {
        return EMPTY
      }

      if (key === null) {
        key = EMPTY
      }

      if (value === null) {
        return encode(key)
      }

      return encode(key) + EQUALS + encode(value)
    }).join(AMPERSAND)
    : EMPTY
}

/**
 * Correctly URL encodes query parameters in a URL and returns the final parsed URL.
 *
 * @param str
 */
/* eslint-disable n/no-deprecated-api */
module.exports = function (str) {
  const parsed = url.parse(str)
  let search
  let path
  let qs

  const rawQs = parsed.query

  if (rawQs && rawQs.length) {
    qs = stringify(parse(parsed.query))
    search = QUESTION_MARK + qs
    path = parsed.pathname + search

    parsed.query = qs
    parsed.search = search
    parsed.path = path

    str = url.format(parsed)
  }

  // Parse again, because Node does not guarantee consistency of properties
  return url.parse(str)
}
/* eslint-enable n/no-deprecated-api */

module.exports.parse = parse
module.exports.stringify = stringify
