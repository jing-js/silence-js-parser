'use strict';

const Parser = require('./parser');
const os = require('os');
const parseBytes = require('./parseBytes')
const Stream = require('stream').Stream;
const File = require('./file');
const EventEmitter = require('events').EventEmitter;

class Part {
  constructor() {
    this.name = null;
    this._headers = null;
    this.filename = null;
    this.mime = null;
    this._file = null;
  }
  get headers() {
    if (this._headers === null) {
      this._headers = Object.create(null);
    }
    return this._headers;
  }
}

class MultipartParser extends EventEmitter {
  constructor(logger, length, boundary, defaultOptions, opts) {

    this.logger = logger;
    this.ctx = null;
    this.error = null;
    this.ended = false;

    this.maxFields = opts && typeof opts.maxFields === 'number' ? opts.maxFields : defaultOptions.maxFields;
    this.maxFieldsSize = opts ? parseBytes(opts.maxFieldsSize, defaultOptions.maxFieldsSize) : defaultOptions.maxFieldsSize;
    this.keepExtensions = opts && typeof opts.keepExtensions === 'boolean' ? opts.keepExtensions : defaultOptions.keepExtensions;
    this.uploadDir = opts && opts.uploadDir ? opts.uploadDir : (defaultOptions.uploadDir || os.tmpdir());
    this.hash = opts && typeof opts.hash === 'boolean' ? opts.hash : defaultOptions.hash;
    this.multiples = opts && typeof opts.multiples === 'boolean' ? opts.multiples : defaultOptions.multiples;

    this.bytesExpected = length;
    this.fileBytesReceived = 0;
    this.headerBytesReceived = 0;
    this.rateLimit = opts ? parseBytes(opts.rateLimit, defaultOptions.rateLimit) : defaultOptions.rateLimit;
    this.fileSizeLimit = opts ? parseBytes(opts.fileSizeLimit, defaultOptions.fileSizeLimit) : defaultOptions.fileSizeLimit;
    this.headerSizeLimit = opts ? parseBytes(opts.headerSizeLimit, defaultOptions.headerSizeLimit) : defaultOptions.headerSizeLimit;

    this._boundary = boundary;
    this._parser = null;
    this._flushing = 0;
    this._fieldsSize = 0;
    this._state = 0;
    this._file = null;
    this._part = null;
    this._resolve = null;
    this._reject = null;
    this._reqEnd = false;
    this._startTime = 0;
    
    this.FileClass = opts && opts.FileClass ? opts.FileClass : File;
    
  }
  _initParser() {
    // var parser = new MultipartParser();

    // let part;
    // let me = this;
    let headerField = '';
    let headerValue = '';
    let transferEncoding = 'binary';
    let headers = null;
    let part = this._part;
    let parser = this._parser;

    parser.initWithBoundary(this._boundary);

    parser.onPartBegin = () => {
      // part = new Part();
      // headerField = '';
      // headerValue = '';
      if (this._file !== null) {
        this._error('size_too_large');
      }
    };

    parser.onHeaderField = (b, start, end) => {
      if (this.ended) {
        return;
      }
      this.headerBytesReceived += end - start;
      if (this.headerSizeLimit > 0 && this.headerBytesReceived > this.headerSizeLimit) {
        return this._error('size_too_large');
      }
      headerField += b.toString('utf-8', start, end);
    };

    parser.onHeaderValue = (b, start, end) => {
      if (this.ended) {
        return;
      }
      this.headerBytesReceived += end - start;
      if (this.headerSizeLimit > 0 && this.headerBytesReceived > this.headerSizeLimit) {
        return this._error('size_too_large');
      }
      headerValue += b.toString('utf-8', start, end);
    };

    parser.onHeaderEnd = () => {
      if (this.ended) {
        return;
      }
      part.headers[headerField.toLowerCase()] = headerValue;
      var m = headerValue.match(/\bname="([^"]+)"/i);
      if (headerField === 'content-disposition') {
        if (m) {
          part.name = m[1];
        }
        part.filename = this._fileName(headerValue);
      } else if (headerField === 'content-type') {
        part.mime = headerValue;
      } else if (headerField === 'content-transfer-encoding') {
        transferEncoding = headerValue.toLowerCase();
      }

      headerField = '';
      headerValue = '';
    };

    parser.onHeadersEnd = () => {
      if (this.ended) {
        return;
      }
      if (transferEncoding !== 'binary' && transferEncoding !== '7bit' && transferEncoding !== '8bit') {
        return this._error('parse_error');
      }
      if (part.filename !== null) {
        this._file = new this.FileClass(part.filename, this._uploadPath(part.filename), part.mime, this.hash);
        this._file.on('error', err => {
          this._error(err);
        });
        this._file.on('finish', () => {
          this._checkEnd();
        })
        this._file.open();
      } else {
        this._error('parse_error');
      }
    };

    parser.onPartData = (b, start, end) => {
      if (this.ended) {
        return;
      }
      if (!this._file) {
        return;
      }
      if (this._state === 0) {
        this.fileBytesReceived = end - start;
        this._state = 1;
      }
      this.pause();
      this._file.write(b.slice(start, end), () => {
        this.resume();
      });
    };

    parser.onPartEnd = function() {
      this._file.end();
    };

    parser.onEnd = err => {
      if (err) {
        this._error(err);
      } else {
        this._state = 999;
        this._checkEnd();
      }
    };

  }
  _checkEnd() {
    if (this.ended) {
      return;
    }
    if (this._state === 999 && this._file && this._file.isFinish) {
      this._end();
    }
  }
  pause() {
    if (this._reqEnd || this.ended) {
      return;
    }
    try {
      this.ctx._originRequest.pause();
    } catch(ex) {
      if (!this.ended) {
        this._error(ex);
      }
    }
  }
  resume() {
    if (this._reqEnd || this.ended) {
      return;
    }
    try {
      this.ctx._originRequest.resume();
    } catch(ex) {
      this._error(ex);
    }
  }
  parse(ctx) {
    this.ctx = ctx;
    this._parser = new Parser();
    let part = new Part();

    let pms = new Promise((resolve, reject) => {
      // save resolve and reject to use later
      this._resolve = resolve; 
      this._reject = reject;
    });

    this._initParser();


    this.ctx._originRequest.on('error', err => {
      this._error(err);
    }).on('aborted', (err) => {
      this._error('request_aborted');
    }).on('data', chunk => {
      if (this.ended) {
        return;
      }
      if (this._state === 1) {
        this.fileBytesReceived += chunk.length;
        if (this.fileSizeLimit > 0 && this.fileBytesReceived > this.fileSizeLimit) {
          return this._error('size_too_large');
        }
      }
      let bytesParsed = this._parser.write(chunk);
      if (bytesParsed !== chunk.length) {
        return this._error('parse_error');
      }
    }).on('end', () => {
      if (this.ended) {
        return;
      }
      this._reqEnd = true;
      this._parser.end();
    });
    return pms;
  }
  _end() {
    if (this.ended) {
      return;
    }
    this._doEnd();
    this._resolve(this._file);
    this._resolve = null;
    this._reject = null;
    this._file = null;
  }
  _doEnd() {
    if (!this._reqEnd) {
      try {
        this.ctx._originRequest.pause();
      } catch(ex) {

      }
    }
    this.ctx = null;
    this.ended = true;
    if (this._file !== null) {
      this._file.destroy();
    }
  }
  _error(err) {
    if (this.ended) {
      return;
    }
    this._doEnd();
    this._reject(err);
    this._resolve = null;
    this._reject = null;
    this._file = null;
  }
  _fileName(headerValue) {
    let m = headerValue.match(/\bfilename="(.*?)"($|; )/i);
    if (!m) return;

    let filename = m[1].substr(m[1].lastIndexOf('\\') + 1);
    filename = filename.replace(/%22/g, '"');
    filename = filename.replace(/&#([\d]{4});/g, function(m, code) {
      return String.fromCharCode(code);
    });
    return filename;
  }
  _uploadPath(filename) {
    var name = 'upload_';
    var buf = crypto.randomBytes(16);
    for (var i = 0; i < buf.length; ++i) {
      name += ('0' + buf[i].toString(16)).slice(-2);
    }

    if (this.keepExtensions) {
      var ext = path.extname(filename);
      ext     = ext.replace(/(\.[a-z0-9]+).*/i, '$1');

      name += ext;
    }

    return path.join(this.uploadDir, name);
  }
}