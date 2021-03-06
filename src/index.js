'use strict';

const qs = require('querystring');
const multipart = require('./multipart');
const jsonReg = /^[\x20\x09\x0a\x0d]*[\[\{]/;
const os = require('os');
const parseBytes = require('./parseBytes');
const B500K = parseBytes('500k');
const B2M = parseBytes('2m');
const B1M = parseBytes('1m');
const AcceptTypeMap = {
  json: 'application/json',
  binary: 'application/octet-stream',
  text: 'text/plain',
  form: 'application/x-www-form-urlencoded'
};
const AcceptTypes = [
  'application/json', 'application/octet-stream',
  'text/plain', 'application/x-www-form-urlencoded'
];

function getAutoRate(sizeLimit) {
  return sizeLimit <= B500K ? 0 : (sizeLimit <= B2M ? B500K : B1M);
}
function getAcceptContentType(options) {
  let ct = options.defaultAcceptContentType || 'json';
  if (AcceptTypeMap.hasOwnProperty(ct)) {
    ct = AcceptTypeMap[ct];
  }
  if (AcceptTypes.indexOf(ct) < 0) {
    throw new Error('Unknown accept content type ' + ct);
  }
  return ct;
}
function createOptions(options = {}) {
  let sizeLimit = parseBytes(options.sizeLimit, '50kb');
  let rateLimit = parseBytes(options.rateLimit, getAutoRate(sizeLimit));
  return {
    sizeLimit,
    rateLimit
  };
}
class SilenceParser {
  constructor(options) {
    this.logger = options.logger;
    this.jsonOptions = createOptions(options.json)
    this.formOptions = createOptions(options.form);
    this.textOptions = createOptions(options.text);
    this.binaryOptions = createOptions(options.binary);
    this.acceptType = getAcceptContentType(options);
    let mopts = options.multipart || {};
    this.multipartOptions = {
      deny: mopts.deny === true,
      rateLimit: parseBytes(mopts.rateLimit, '1m'),
      fileSizeLimit: parseBytes(mopts.sizeLimit, '3m'),
      headerSizeLimit: parseBytes(mopts.headerSizeLimit, '1kb'),
      hash: mopts.hash || false,
      keepExtension: mopts.keepExtension || false,
      uploadDir: mopts.uploadDir || os.tmpdir()
    }
  }
  _text(ctx, rate, limit, length) {
    // console.log('parse', rate, limit, length);
    return new Promise((resolve, reject) => {
      let text = '';
      let total = 0;
      function onData(chunk) {
        total += chunk.length;
        text += chunk.toString();
      }
      function onEnd(err) {
        // console.log(err, total, length);
        if (err) {
          reject(err);
        } else if (total !== length) {
          reject(409);
        } else {
          resolve(text);
        }
      }
      if (!ctx.readRequest(onData, onEnd, limit, rate)) {
        this.logger.serror('parser', 'unexpected ctx.readRequest return');
        reject(500);
      }
    });
  }
  _json(ctx, rate, limit, length) {
    return this._text(ctx, rate, limit, length).then(text => {
      if (!text || !jsonReg.test(text)) {
        return undefined;
      }
      try {
        return JSON.parse(text);
      } catch(ex) {
        return undefined;
      }
    });
  }
  _form(ctx, rate, limit, length) {
    return this._text(ctx, rate, limit, length).then(text => {
      if (!text) {
        return undefined;
      }
      try {
        return qs.parse(text);
      } catch(ex) {
        return undefined;
      }
    });
  }
  _binary(ctx, rate, limit, length) {
    return new Promise((resolve, reject) => {
      let buf = Buffer.allocUnsafe(0);
      let total = 0;
      function onData(chunk) {
        total += chunk.length;
        buf = Buffer.concat([buf, chunk], total);
      }
      function onEnd(err) {
        // console.log(err, total, length);
        if (err) {
          reject(err);
        } else if (total !== length) {
          reject(409);
        } else {
          resolve(buf);
        }
      }
      if (!ctx.readRequest(onData, onEnd, limit, rate)) {
        this.logger.serror('parser', 'unexpected ctx.readRequest return');
        reject(500);
      }
    });
  }
  post(ctx, options) {
    let length = ctx.headers['content-length'];
    // console.log(length);
    if (!length) {
      return Promise.reject(411);
    }
    let nl = 0;
    try {
      nl = parseInt(length, 10);
    } catch(ex) {
      nl = 0;
    }
    if (nl <= 0) {
      return Promise.reject(411);
    }
    let limit = 0;
    let rate = 0;
    let type = ctx._originRequest.headers['content-type'];
    // console.log(type);
    if (!type) {
      return Promise.reject(415);
    }
    let acceptContentType = this.acceptType;
    if (options && options.acceptContentType) {
      acceptContentType = options.acceptContentType;
      if (AcceptTypeMap.hasOwnProperty(acceptContentType)) {
        acceptContentType = AcceptTypeMap[acceptContentType];
      }
    }
    if (type !== acceptContentType) {
      console.log(acceptContentType, type);
      return Promise.reject(415);
    }

    if (type === 'application/x-www-form-urlencoded') {
      limit = options ? parseBytes(options.sizeLimit, this.formOptions.sizeLimit) : this.formOptions.sizeLimit;
      rate = options ? parseBytes(options.rateLimit, getAutoRate(limit)) : getAutoRate(limit);
      // console.log(limit, rate);
      if (limit > 0 && nl > limit) {
        return Promise.reject(413);
      }
      return this._form(ctx, rate, limit, nl);
    } else if (type === 'application/json') {
      limit = options ? parseBytes(options.sizeLimit, this.jsonOptions.sizeLimit) : this.jsonOptions.sizeLimit;
      rate = options ? parseBytes(options.rateLimit, getAutoRate(limit)) : getAutoRate(limit);
      if (limit > 0 && nl > limit) {
        return Promise.reject(413);
      }
      return this._json(ctx, rate, limit, nl);
    } else if (type === 'text/plain') {
      limit = options ? parseBytes(options.sizeLimit, this.textOptions.sizeLimit) : this.textOptions.sizeLimit;
      rate = options ? parseBytes(options.rateLimit, getAutoRate(limit)) : getAutoRate(limit);
      if (limit > 0 && nl > limit) {
        return Promise.reject(413);
      }
      return this._text(ctx, rate, limit, nl);
    } else if (type === 'application/octet-stream') {
      limit = options ? parseBytes(options.sizeLimit, this.binaryOptions.sizeLimit) : this.binaryOptions.sizeLimit;
      rate = options ? parseBytes(options.rateLimit, getAutoRate(limit)) : getAutoRate(limit);
      if (limit > 0 && nl > limit) {
        return Promise.reject(413);
      }
      return this._binary(ctx, rate, limit, nl);
    } else {
      return Promise.reject(415);
    }
  }
  multipart(ctx, options) {
    let length = ctx.headers['content-length'];
    if (!length) {
      return Promise.reject(411);
    }
    let nl = 0;
    try {
      nl = parseInt(length, 10);
    } catch(ex) {
      nl = 0;
    }
    if (nl <= 0) {
      return Promise.reject(411);
    }
    let headerSizeLimit = options ? parseBytes(options.headerSizeLimit, this.multipartOptions.headerSizeLimit) : this.multipartOptions.headerSizeLimit;
    let fileSizeLimit = options ? parseBytes(options.fileSizeLimit, this.multipartOptions.fileSizeLimit) : this.multipartOptions.fileSizeLimit;
    let limit = headerSizeLimit + fileSizeLimit;
    if (limit > 0 && nl > limit) {
      return Promise.reject(413);
    }
    let type = ctx._originRequest.headers['content-type'];
    if (!type) {
      return Promise.reject(415);
    }
    if (!type.startsWith('multipart/form-data')) {
      return Promise.reject(415);
    }
    let m = type.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!m) {
      return Promise.reject(415);
    }
    let rate = options ? parseBytes(options.rateLimit, getAutoRate(limit)) : getAutoRate(limit);

    return multipart(ctx, rate, nl, {
      boundary: m[1] || m[2],
      FileClass: options ? options.FileClass : null,
      headerSizeLimit,
      fileSizeLimit,
      hash: options && options.hash ? true : this.multipartOptions.hash,
      keepExtension: options && options.keepExtension ? true : this.multipartOptions.keepExtension,
      uploadDir: options ? (options.uploadDir || this.multipartOptions.uploadDir) : this.multipartOptions.uploadDir
    });
  }
}

SilenceParser.File = require('./file'); // export File class
SilenceParser.parseBytes = parseBytes;

module.exports = SilenceParser;
