'use strict';

/**
 * Modified from [formidable](https://github.com/felixge/node-formidable/blob/master/lib/multipart_parser.js) by Yuhang Ge<abeyuhang@gmail.com>
 */

const Buffer = require('buffer').Buffer;
let s = 0,
    S =
    { PARSER_UNINITIALIZED: s++,
      START: s++,
      START_BOUNDARY: s++,
      HEADER_FIELD_START: s++,
      HEADER_FIELD: s++,
      HEADER_VALUE_START: s++,
      HEADER_VALUE: s++,
      HEADER_VALUE_ALMOST_DONE: s++,
      HEADERS_ALMOST_DONE: s++,
      PART_DATA_START: s++,
      PART_DATA: s++,
      PART_END: s++,
      END: s++
    },

    f = 1,
    F =
    { PART_BOUNDARY: f,
      LAST_BOUNDARY: f *= 2
    },

    LF = 10,
    CR = 13,
    SPACE = 32,
    HYPHEN = 45,
    COLON = 58,
    A = 97,
    Z = 122,

    lower = function(c) {
      return c | 0x20;
    };

const noop = () => {};

class MultipartParser {
  static stateToString(stateNumber) {
    for (let state in S) {
      let number = S[state];
      if (number === stateNumber) {
        return state;
      }
    }
  }
  constructor() {
    this.boundary = null;
    this.boundaryChars = null;
    this.lookbehind = null;
    this.state = S.PARSER_UNINITIALIZED;

    this.index = null;
    this.flags = 0;

    this.onPartBegin = noop;
    this.onHeaderField = noop;
    this.onHeaderValue = noop;
    this.onHeaderEnd = noop;
    this.onHeadersEnd = noop;
    this.onPartData = noop;
    this.onPartEnd = noop;
    this.onEnd = noop;
    this.onError = noop;

    this._marks = new Map();
  }
  initWithBoundary(str) {
    this.boundary = new Buffer(str.length+4);
    this.boundary.write('\r\n--', 0);
    this.boundary.write(str, 4);
    this.lookbehind = new Buffer(this.boundary.length+8);
    this.state = S.START;

    this.boundaryChars = {};
    for (let i = 0; i < this.boundary.length; i++) {
      this.boundaryChars[this.boundary[i]] = true;
    }
  }
  has(name) {
    return this._marks.has(name);
  }
  get(name) {
    return this._marks.get(name);
  }
  mark(name, i) {
    this._marks.set(name, i);
  }
  clear(name) {
    this._marks.delete(name);
  }
  write(buffer) {
    let self = this;
    let i = 0,
      len = buffer.length,
      prevIndex = this.index,
      index = this.index,
      state = this.state,
      flags = this.flags,
      lookbehind = this.lookbehind,
      boundary = this.boundary,
      boundaryChars = this.boundaryChars,
      boundaryLength = this.boundary.length,
      boundaryEnd = boundaryLength - 1,
      bufferLength = buffer.length,
      c,
      cl;

      // mark = function(name) {
      //   self[name+'Mark'] = i;
      // },
      // clear = function(name) {
      //   delete self[name+'Mark'];
      // },
      // callback = function(name, buffer, start, end) {
      //   if (start !== undefined && start === end) {
      //     return;
      //   }
      //
      //   var callbackSymbol = 'on'+name.substr(0, 1).toUpperCase()+name.substr(1);
      //   if (callbackSymbol in self) {
      //     self[callbackSymbol](buffer, start, end);
      //   }
      // },
      // dataCallback = function(name, clear) {
      //   var markSymbol = name+'Mark';
      //   if (!(markSymbol in self)) {
      //     return;
      //   }
      //
      //   if (!clear) {
      //     callback(name, buffer, self[markSymbol], buffer.length);
      //     self[markSymbol] = 0;
      //   } else {
      //     callback(name, buffer, self[markSymbol], i);
      //     delete self[markSymbol];
      //   }
      // };

    for (i = 0; i < len; i++) {
      c = buffer[i];
      switch (state) {
        case S.PARSER_UNINITIALIZED:
          return i;
        case S.START:
          index = 0;
          state = S.START_BOUNDARY;
        case S.START_BOUNDARY:
          if (index == boundary.length - 2) {
            if (c == HYPHEN) {
              flags |= F.LAST_BOUNDARY;
            } else if (c != CR) {
              return i;
            }
            index++;
            break;
          } else if (index - 1 == boundary.length - 2) {
            if (flags & F.LAST_BOUNDARY && c == HYPHEN){
              this.onEnd();
              state = S.END;
              flags = 0;
            } else if (!(flags & F.LAST_BOUNDARY) && c == LF) {
              index = 0;
              this.onPartBegin();
              state = S.HEADER_FIELD_START;
            } else {
              return i;
            }
            break;
          }

          if (c != boundary[index+2]) {
            index = -2;
          }
          if (c == boundary[index+2]) {
            index++;
          }
          break;
        case S.HEADER_FIELD_START:
          state = S.HEADER_FIELD;
          this.mark('headerField', i);
          index = 0;
        case S.HEADER_FIELD:
          if (c == CR) {
            this.clear('headerField');
            state = S.HEADERS_ALMOST_DONE;
            break;
          }

          index++;
          if (c == HYPHEN) {
            break;
          }

          if (c == COLON) {
            if (index == 1) {
              // empty header field
              return i;
            }
            // dataCallback('headerField', true);
            if (this.has('headerField')) {
              this.onHeaderField(buffer, this.get('headerField'), i);
              this.clear('headerField');
            }
            state = S.HEADER_VALUE_START;
            break;
          }

          cl = lower(c);
          if (cl < A || cl > Z) {
            return i;
          }
          break;
        case S.HEADER_VALUE_START:
          if (c == SPACE) {
            break;
          }

          this.mark('headerValue', i);
          state = S.HEADER_VALUE;
        case S.HEADER_VALUE:
          if (c == CR) {
            // dataCallback('headerValue', true);
            if (this.has('headerValue')) {
              this.onHeaderValue(buffer, this.get('headerValue'), i);
              this.clear('headerValue');
            }
            // callback('headerEnd');
            this.onHeaderEnd();
            state = S.HEADER_VALUE_ALMOST_DONE;
          }
          break;
        case S.HEADER_VALUE_ALMOST_DONE:
          if (c != LF) {
            return i;
          }
          state = S.HEADER_FIELD_START;
          break;
        case S.HEADERS_ALMOST_DONE:
          if (c != LF) {
            return i;
          }

          // callback('headersEnd');
          this.onHeadersEnd();
          state = S.PART_DATA_START;
          break;
        case S.PART_DATA_START:
          state = S.PART_DATA;
          this.mark('partData', i);
        case S.PART_DATA:
          prevIndex = index;

          if (index === 0) {
            // boyer-moore derrived algorithm to safely skip non-boundary data
            i += boundaryEnd;
            while (i < bufferLength && !(buffer[i] in boundaryChars)) {
              i += boundaryLength;
            }
            i -= boundaryEnd;
            c = buffer[i];
          }

          if (index < boundary.length) {
            if (boundary[index] == c) {
              if (index === 0) {
                // dataCallback('partData', true);
                if (this.has('partData')) {
                  this.onPartData(buffer, this.get('partData'), i);
                  this.clear('partData');
                }
              }
              index++;
            } else {
              index = 0;
            }
          } else if (index == boundary.length) {
            index++;
            if (c == CR) {
              // CR = part boundary
              flags |= F.PART_BOUNDARY;
            } else if (c == HYPHEN) {
              // HYPHEN = end boundary
              flags |= F.LAST_BOUNDARY;
            } else {
              index = 0;
            }
          } else if (index - 1 == boundary.length)  {
            if (flags & F.PART_BOUNDARY) {
              index = 0;
              if (c == LF) {
                // unset the PART_BOUNDARY flag
                flags &= ~F.PART_BOUNDARY;
                this.onPartEnd();
                this.onPartBegin();
                // callback('partEnd');
                // callback('partBegin');
                state = S.HEADER_FIELD_START;
                break;
              }
            } else if (flags & F.LAST_BOUNDARY) {
              if (c == HYPHEN) {
                // callback('partEnd');
                // callback('end');
                this.onPartEnd();
                this.onEnd();
                state = S.END;
                flags = 0;
              } else {
                index = 0;
              }
            } else {
              index = 0;
            }
          }

          if (index > 0) {
            // when matching a possible boundary, keep a lookbehind reference
            // in case it turns out to be a false lead
            lookbehind[index-1] = c;
          } else if (prevIndex > 0) {
            // if our boundary turned out to be rubbish, the captured lookbehind
            // belongs to partData
            // callback('partData', lookbehind, 0, prevIndex);
            this.onPartData(lookbehind, 0, prevIndex);
            prevIndex = 0;
            this.mark('partData', i);

            // reconsider the current character even so it interrupted the sequence
            // it could be the beginning of a new sequence
            i--;
          }

          break;
        case S.END:
          break;
        default:
          return i;
      }
    }

    if (this.has('headerField')) {
      this.onHeaderField(buffer, this.get('headerField'), buffer.length);
      this.mark('headerField', 0);
    }
    if (this.has('headerValue')) {
      this.onHeaderValue(buffer, this.get('headerValue'), buffer.length);
      this.mark('headerValue', 0);
    }
    if (this.has('partData')) {
      this.onPartData(buffer, this.get('partData'), buffer.length);
      this.mark('partData', 0);
    }
    // dataCallback('headerField');
    // dataCallback('headerValue');
    // dataCallback('partData');

    this.index = index;
    this.state = state;
    this.flags = flags;

    return len;
  }
  end() {
    // var callback = function(self, name) {
    //   var callbackSymbol = 'on'+name.substr(0, 1).toUpperCase()+name.substr(1);
    //   if (callbackSymbol in self) {
    //     self[callbackSymbol]();
    //   }
    // };
    if ((this.state == S.HEADER_FIELD_START && this.index === 0) ||
      (this.state == S.PART_DATA && this.index == this.boundary.length)) {
      // callback(this, 'partEnd');
      this.onPartEnd();
    }
    this.onEnd(this.state !== S.END ? 'stream_ended_unexpectedly' : null);

  }
  explain() {
    return 'state = ' + MultipartParser.stateToString(this.state);
  }
}

exports.MultipartParser = MultipartParser;
