'use strict'

// eMudhra intermediate CA key compromise.
//
// SHA-256 (base64) of the SubjectPublicKeyInfo of each eMudhra intermediate CA revoked on
// 2026-10-18 because its private key can be derived from the public certificate. Anyone can
// therefore mint a certificate for any hostname that chains to one of these CAs, so we reject any
// TLS chain that contains one of these public keys.
//
// Node verifies against a static root bundle with no revocation checks, so it does not honour the
// revocation on its own. The roots cannot be dropped instead: `AAA Certificate Services` also
// anchors legitimate Sectigo chains. Each key was certified twice (issued under emSign and
// cross-signed by AAA), so matching on the public key covers both certificates and any re-issue.
//
// Source: https://emudhra.we-have-a-problem.com/impacted-intermediates.json
var REVOKED_CA_SPKI_SHA256 = new Map([
  ['6+1kdcLC2A/LGZ8/6N1uazzmC3frFdTkLD3sDG9bUQU=', 'EM DV TLS CA - G3B'],
  ['Q7/6GdbvZRRR9oQeAZkx6W9vLq7/KKtLbxzkV23icXs=', 'EM OV TLS CA - G3B'],
  ['4CVMf83CZeLw+KQo2rt1q0rgObSHLWL17lfwh31aikE=', 'EM EV TLS CA - G3B'],
  ['Sd01PcK5GaN3BkURfQ5gwWEV59G8JZ7v5zSwDqQ0/l8=', 'EM DV TLS CA - G3C'],
  ['Y+zv7kMdSVI7wRNsTnLQIGpHcIbK9gbNXPAlaGwQnPg=', 'EM OV TLS CA - G3C'],
  ['XAZgorFkkQ2P9YnBjhRVLp4Owjfc7+LLc21BpIEfgaA=', 'EM EV TLS CA - G3C'],
  ['7E/6GtCsiAgTFLeq/+9qkfl81XKRu1umhsVBX1609rY=', 'EM OV CS CA - G3B'],
  ['ksBj1n6PFNtx0ojhEmb/2vacvxFfe6sU87wvaNJeDjA=', 'EM OV CS CA - G3C']
])

module.exports = { REVOKED_CA_SPKI_SHA256: REVOKED_CA_SPKI_SHA256 }
