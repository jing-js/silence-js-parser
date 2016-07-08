'use strict';

const BYTES_UNIT = {
  'k': 1024,
  'm': 1024 * 1024,
  'g': 1024 * 1024 * 1024,
  't': 1024 * 1024 * 1024
};
function _doParseBytes(val) {
  if (typeof val === 'number') {
    return val;
  }
  let m = val.match(/^(\d+(?:\.\d+)?)([kmgt])b?/);
  if (!m) {
    return 0;
  }
  return (parseFloat(m[1]) * BYTES_UNIT[m[2]]) | 0;
}

function parseBytes(val, defaultSizeLimit = '50kb') {
  if (typeof val === 'number') {
    return isNaN(val) || val < 0 ? _doParseBytes(defaultSizeLimit) : val;
  }
  if (typeof val !== 'string') {
    return _doParseBytes(defaultSizeLimit);
  }
  let size = _doParseBytes(val);
  return size < 0 ? _doParseBytes(defaultSizeLimit) : size;
}

module.exports = parseBytes;
