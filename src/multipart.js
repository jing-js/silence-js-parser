'use strict';

const Parser = require('./parser');
const os = require('os');
const parseBytes = require('./parseBytes')
const Stream = require('stream').Stream;
const path = require('path');
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

function multipart(ctx, rate, length, opts) {
  return new Promise((resolve, reject) => {
    // console.log(rate, length, opts);

    let parser = new Parser();
    let FileClass = opts && opts.FileClass ? opts.FileClass : File;
    let file = null;
    let part = null;
    let headerBytes = 0;
    let fileBytes = 0;
    let headerField = '';
    let headerValue = '';
    let transferEncoding = 'binary';
    let err = null;
    let ended = false;
    let state = 0;


    parser.initWithBoundary(opts.boundary);
    parser.onPartBegin = () => {
      if (err || ended || state === 999) {
        return;
      }
      // console.log('on part begin')
      if (file !== null || part !== null) {
        err = 'size_too_large';
      } else {
        part = new Part();
      }
      return err;
    };

    parser.onHeaderField = (b, start, end) => {
      if (err || ended || state === 999) {
        return;
      }
      // console.log('on header field')
      headerBytes += end - start;
      if (opts.headerSizeLimit > 0 && headerBytes > opts.headerSizeLimit) {
        err = 'size_too_large';
      } else {
        headerField += b.toString('utf-8', start, end).toLowerCase();
      }
      return err;
    };

    parser.onHeaderValue = (b, start, end) => {
      if (err || ended || state === 999) {
        return;
      }
      // console.log('on header value')
      headerBytes += end - start;
      if (opts.headerSizeLimit > 0 && headerBytes > opts.headerSizeLimit) {
        err = 'size_too_large';
      } else {
        headerValue += b.toString('utf-8', start, end);
      }
      return err;
    };

    parser.onHeaderEnd = () => {
      if (err || ended || state === 999) {
        return;
      }
      // console.log('on header end', headerField)
      part.headers[headerField] = headerValue;
      if (headerField === 'content-disposition') {
        let m = headerValue.match(/\bname="([^"]+)"/i);
        if (m) {
          part.name = m[1];
        }
        part.filename = getFilename(headerValue);
      } else if (headerField === 'content-type') {
        part.mime = headerValue;
      } else if (headerField === 'content-transfer-encoding') {
        transferEncoding = headerValue.toLowerCase();
      }
      headerField = '';
      headerValue = '';
    };

    parser.onHeadersEnd = () => {
      if (err || ended || state === 999) {
        return;
      }
      // console.log('on headers end')
      // console.log(part);
      if (transferEncoding !== 'binary' && transferEncoding !== '7bit' && transferEncoding !== '8bit') {
        err = 'parse_error';
        return err;
      }
      if (part.filename !== null) {
        // console.log('new file')
        file = new FileClass(part.filename, getUploadPath(opts.uploadDir, part.filename), part.mime, opts.hash);
        file.on('error', error => {
          console.log('fiiiiii error', error);
          err = error;
          done(error);
        });
        file.on('finish', () => {
          done();
        });
        file.open();
        // console.log(file)
      } else {
        err = 'parse_error';
      }
      return err;
    };

    parser.onPartData = (b, start, end) => {
      if (err || ended || state === 999) {
        return;
      }
      if (state === 0) {
        fileBytes = end - start;
        state = 1;
      } else {
        fileBytes += end - start;
      }

      // console.log('on part data', fileBytes, opts.fileSizeLimit)

      if (opts.fileSizeLimit > 0 && fileBytes > opts.fileSizeLimit) {
        err = 'size_too_large';
        return err;
      }
      file.write(b.slice(start, end));
    };

    parser.onPartEnd = function() {
      if (err || ended || state === 999) {
        return;
      }
      // console.log('on part end');
      file.end();
    };

    parser.onEnd = error => {
      // console.log('parser end', error)
      ended = true;
      done(error);
    };

    ctx.readRequest(function onData(chunk) {
      if (err || ended || state === 999) {
        return err || 'already_ended';
      }
      // console.log('on ctx data', chunk.length);
      parser.write(chunk);
      return err;
    }, function onEnd(error) {
      if (state === 999) {
        return;
      }
      // console.log('ctx end read', error)
      if (error) {
        return done(error);
      }
      parser.end();
    }, opts.headerSizeLimit + opts.fileSizeLimit, rate);

    function done(error) {
      if (state === 999) {
        return; // already handled
      }
      // console.log('check done', error);

      if (error) {
        file && file.destroy();
        state = 999;
        reject(error);
        return;
      } else if (file && file.isFinish && ended) {
        console.log('realy file done');
        state = 999;
        resolve(file);
      } else {
        // do nothing, not finish yet.
      }
    }
  });
}

function getFilename(headerValue) {
  console.log('get file name')
  let m = headerValue.match(/\bfilename="(.*?)"($|; )/i);
  if (!m) {
    return null;
  }
  let filename = m[1].substr(m[1].lastIndexOf('\\') + 1);
  filename = filename.replace(/%22/g, '"');
  filename = filename.replace(/&#([\d]{4});/g, (m, code) => String.fromCharCode(code));
  return filename;
}

function getUploadPath(dir, filename, keepExt) {
  let name = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  if (keepExt) {
    name += path.extname(filename).replace(/(\.[a-z0-9]+).*/i, '$1');
  }
  return path.join(dir, name);
}

module.exports = multipart;
