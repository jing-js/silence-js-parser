'use strict';

const raw = require('raw-body');
const qs = require('querystring');
const jsonReg = /^[\x20\x09\x0a\x0d]*[\[\{]/;

class SilenceParser {
  constructor(options) {
    this.logger = options.logger;
    this.jsonOptions = Object.assign({}, options.json || {}, {
      limit: '100kb',
      encoding: 'utf8'
    });
    this.formOptions = Object.assign({}, options.form || {}, {
      limit: '100kb',
      encoding: 'utf8'
    });
    this.textOptions = Object.assign({}, options.json || {}, {
      limit: '100kb',
      encoding: 'utf8'
    });
  }
  _raw(ctx, defaultOptions, options) {
    let req = ctx._originRequest;
    let opts = {
      length: req.headers['content-length'] || undefined, 
      limit: options ? (options.limit || defaultOptions.limit) : defaultOptions.limit,
      encoding: options ? (options.encoding || defaultOptions.encoding) : defaultOptions.encoding
    };
    return raw(req, opts);
  }
  _json(ctx, options) {
    return this._raw(ctx, this.jsonOptions, options).then(text => {
      return (!text || !jsonReg.test(text)) ? {} : JSON.parse(text);
    });
  }
  _form(ctx, options) {
    return this._raw(ctx, this.formOptions, options).then(text => {
      this.logger.debug('post data:' + text);
      return qs.parse(text);
    });
  }
  _text(ctx, options) {
    return this._raw(ctx, textOptions, options);
  }
  post(ctx, options) {
    let type = ctx._originRequest.headers['content-type'];
    if (type.startsWith('application/x-www-form-urlencoded')) {
      return this._form(ctx, options);
    } else if (type.startsWith('application/json') || type.startsWith('application/json-patch+json') || type.startsWith('application/vnd.api+json') || type.startsWith('application/csp-report')) {
      return this._json(ctx, options);
    } else if (type.startsWidth('text/')) {
      return this._text(ctx, options);
    } else {
      return Promise.resolve(null);
    }
  }
  multipart(ctx, options) {
    let type = ctx._originRequest.headers['content-type'];
    if (type !== 'multipart/form-data') {
      return Promise.resolve(null);
    }
    return Promsie.resolve(null); // todo support multipart
  }
}

module.exports = SilenceParser;
