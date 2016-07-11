'use strict';

const qs = require('querystring');
const multipart = require('./multipart');
const jsonReg = /^[\x20\x09\x0a\x0d]*[\[\{]/;
const os = require('os');
const parseBytes = require('./parseBytes');
const B500K = parseBytes('500k');
const B2M = parseBytes('2m');
const B1M = parseBytes('1m');

function getAutoRate(sizeLimit) {
  return sizeLimit <= B500K ? 0 : (sizeLimit <= B2M ? B500K : B1M);
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
    let mopts = options.multipart || {};
    this.multipartOptions = {
      rateLimit: parseBytes(mopts.rateLimit, '1m'),
      fileSizeLimit: parseBytes(mopts.sizeLimit, '3m'),
      headerSizeLimit: parseBytes(mopts.headerSizeLimit, '1kb'),
      hash: mopts.hash || false,
      keepExtension: mopts.keepExtension || false,
      uploadDir: mopts.uploadDir || os.tmpdir()
    }
  }
  _text(ctx, rate, limit, length) {
    console.log('parse', rate, limit, length);
    return new Promise((resolve, reject) => {
      let text = '';
      let total = 0;
      function onData(chunk) {
        // console.log('on data', chunk.length);
        total += chunk.length;
        text += chunk.toString();
      }
      function onEnd(err) {
        // console.log(err, total, length);
        if (err) {
          reject(err);
        } else if (total !== length) {
          reject('header_content_length_wrong');
        } else {
          resolve(text);
        }
      }
      if (!ctx.readRequest(onData, onEnd, limit, rate)) {
        // console.log('bad')
        reject('readRequest busy');
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
  post(ctx, options) {
    let length = ctx.headers['content-length'];
    // console.log(length);
    if (!length) {
      return Promise.reject('header_content_length_miss');
    }
    let nl = 0;
    try {
      nl = parseInt(length, 10);
    } catch(ex) {
      nl = 0;
    }
    if (nl <= 0) {
      return Promise.reject('body_empty');
    }
    let limit = 0;
    let rate = 0;
    let type = ctx._originRequest.headers['content-type'];
    // console.log(type);
    if (!type) {
      return Promise.reject('header_content_type_miss');
    }
    if (type.startsWith('application/x-www-form-urlencoded')) {
      limit = options ? parseBytes(options.sizeLimit, this.formOptions.sizeLimit) : this.formOptions.sizeLimit;
      rate = options ? parseBytes(options.rateLimit, getAutoRate(limit)) : getAutoRate(limit);
      console.log(limit, rate);
      if (limit > 0 && nl > limit) {
        return Promise.reject('size_too_large');
      }
      return this._form(ctx, rate, limit, nl);
    } else if ((
        type.startsWith('application/json') ||
        type.startsWith('application/json-patch+json') ||
        type.startsWith('application/vnd.api+json') ||
        type.startsWith('application/csp-report')
      )) {
      limit = options ? parseBytes(options.sizeLimit, this.jsonOptions.sizeLimit) : this.jsonOptions.sizeLimit;
      rate = options ? parseBytes(options.rateLimit, getAutoRate(limit)) : getAutoRate(limit);
      if (limit > 0 && nl > limit) {
        return Promise.reject('size_too_large');
      }
      return this._json(ctx, rate, limit, nl);
    } else if (type.startsWith('text/')) {
      limit = options ? parseBytes(options.sizeLimit, this.textOptions.sizeLimit) : this.textOptions.sizeLimit;
      rate = options ? parseBytes(options.rateLimit, getAutoRate(limit)) : getAutoRate(limit);
      if (limit > 0 && nl > limit) {
        return Promise.reject('size_too_large');
      }
      return this._text(ctx, rate, limit, nl);
    } else {
      return Promise.reject('header_content_type_dismatch');
    }
  }
  multipart(ctx, options) {
    let length = ctx.headers['content-length'];
    if (!length) {
      return Promise.reject('header_content_length_miss');
    }
    let nl = 0;
    try {
      nl = parseInt(length, 10);
    } catch(ex) {
      nl = 0;
    }
    if (nl <= 0) {
      return Promise.reject('body_empty');
    }
    let headerSizeLimit = options ? parseBytes(options.headerSizeLimit, this.multipartOptions.headerSizeLimit) : this.multipartOptions.headerSizeLimit;
    let fileSizeLimit = options ? parseBytes(options.fileSizeLimit, this.multipartOptions.fileSizeLimit) : this.multipartOptions.fileSizeLimit;
    let limit = headerSizeLimit + fileSizeLimit;
    if (limit > 0 && nl > limit) {
      return Promise.reject('size_too_large');
    }
    let type = ctx._originRequest.headers['content-type'];
    if (!type) {
      return Promise.reject('header_content_type_miss');
    }
    if (!type.startsWith('multipart/form-data')) {
      return Promise.reject('header_content_type_dismatch');
    }
    let m = type.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!m) {
      return Promise.reject('header_content_type_boundary_dismatch');
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
