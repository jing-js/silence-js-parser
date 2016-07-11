// var util = require('util'),
//     WriteStream = require('fs').WriteStream,

//     

'use strict';

const EventEmitter = require('events').EventEmitter;
const crypto = require('crypto');
const fs = require('fs');

class File extends EventEmitter {
  constructor(name, path, type, hash) {
    super();
    this.size = 0;
    this.path = path || null;
    this.name = name || null;
    this.type = type || null;
    this.hash = null;

    this._hasher = typeof hash === 'string' ? crypto.createHash(hash) : null;
    this._stream = null;
    this._destroied = false;
    
  }
  _unlink() {
    if (!this._stream) {
      return;
    }
    fs.unlink(this.path);
  }
  open() {
    this._stream = fs.createWriteStream(this.path, {
      flags: 'ax',
      autoClose: true
    });
    this._stream.on('error', err => {
      // console.log('file error', err);
      if (!this._stream) {
        return;
      }
      if (err.code !== 'EEXIST') {
        this._unlink();
      }
      this._stream = null;
      if (!this._destroied) {
        this.emit('error', err);
      }
    });
    this._stream.on('finish', () => {
      if (!this._stream) {
        return;
      }
      if (!this._destroied && this._hasher) {
        this.hash = this._hasher.digest('hex');
      }
      if (this._destroied) {
        this._unlink();
      }
      this._stream = undefined;
      if (!this._destroied) {
        this.emit('finish');
      }
    });
  }
  write(chunk, cb) {
    if (!this._stream) {
      return;
    }
    if (this._hasher) {
      this._hasher.update(chunk);
    }
    this._stream.write(chunk, () => {
      this.size += chunk.length;
      cb && cb()
    });
  }
  end() {
    if (!this._stream) {
      return;
    }
    this._stream.end()
  }
  destroy() {
    if (!this._stream) {
      return;
    }
    this._destroied = true;
    this.end();
  }
  get isFinish() {
    return this._stream === undefined;
  }
}

module.exports = File;
