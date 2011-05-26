/*jslint devel: true, debug: true, es5: true, onevar: true, undef: true, nomen: true, eqeqeq: true, plusplus: true, bitwise: true, regexp: true, newcap: true, immed: true, strict: true */
// This module is meant for modern browsers. Not much abstraction or 1337 majic
var window;
(function (undefined) {
  "use strict";

  var url = require('url')
    , browserJsonpClient = require('./browser-jsonp')
    , nativeHttpClient
    , globalOptions
    , restricted
    , debug = false
    ; // TODO underExtend localOptions

  // Restricted Headers
  // http://www.w3.org/TR/XMLHttpRequest/#the-setrequestheader-method
  restricted = [
      "Accept-Charset"
    , "Accept-Encoding"
    , "Connection"
    , "Content-Length"
    , "Cookie"
    , "Cookie2"
    , "Content-Transfer-Encoding"
    , "Date"
    , "Expect"
    , "Host"
    , "Keep-Alive"
    , "Referer"
    , "TE"
    , "Trailer"
    , "Transfer-Encoding"
    , "Upgrade"
    , "User-Agent"
    , "Via"
  ];
  restricted.forEach(function (val, i, arr) {
    arr[i] = val.toLowerCase();
  });

  if (!window.XMLHttpRequest) {
    window.XMLHttpRequest = function() {
      return new ActiveXObject('Microsoft.XMLHTTP');
    };
  }
  if (window.XDomainRequest) {
    // TODO fix IE's XHR/XDR to act as normal XHR2
    // check if the location.host is the same (name, port, not protocol) as origin
  }


  function encodeData(options, xhr2) {
    var data
      , ct = options.overrideResponseType || xhr2.getResponseHeader("content-type") || ""
      , text = xhr2.responseText
      , len = text.length
      ;

    ct = ct.toLowerCase();

    if ('binary' === ct) {
      // TODO only Chrome 13 currently handles ArrayBuffers well
      // imageData could work too
      // http://synth.bitsnbites.eu/
      // http://synth.bitsnbites.eu/play.html
      // var ui8a = new Uint8Array(data, 0);
      var i
        , ui8a = Array(len)
        ;

      for (i = 0; i < text.length; i += 1) {
        ui8a[i] = (text.charCodeAt(i) & 0xff);
      }

      return ui8a;
    }

    if (ct.indexOf("xml") >= 0) {
      return xhr2.responseXML;
    }

    if (ct.indexOf("jsonp") >= 0 || ct.indexOf("javascript") >= 0) {
      console.log("forcing of jsonp not yet supported");
      return text;
    }

    if (ct.indexOf("json") >= 0) {
      try {
        data = JSON.parse(txt);
      } catch(e) {
        data = undefined;
      }
      return text;
    }

    return xhr2.responseText;
  }

  function browserHttpClient(req, res) {
    var options = req.userOptions;
      , xhr2
      , xhr2Request
      , timeoutToken
      ;

    function onTimeout() {
        ahr.log('timeout-log browserHttpClient-2');
        req.emit("timeout", {});
    }

    function resetTimeout() {
      clearTimeout(timeoutToken);
      timeoutToken = setTimeout(onTimeout, options.timeout);
    }

    function sanatizeHeaders(header) {
      var value = options.headers[header];

      if (-1 !== restricted.indexOf(header.toLowerCase())) {
        console.log('Cannot set header ' + header + ' because it is restricted (http://www.w3.org/TR/XMLHttpRequest/#the-setrequestheader-method)');
        return;
      }

      try {
        // throws INVALID_STATE_ERROR if called before `open()`
        xhr2.setRequestHeader(header, value);
      } catch(e) {
        console.log('error setting header: ' + header);
        console.log(e);
      }
    }

    // A little confusing that the request object gives you
    // the response handlers and that the upload gives you
    // the request handlers, but oh well
    xhr2 = new XMLHttpRequest();
    xhr2Request = xhr2.upload;

    /* Proper States */
    xhr2.addEventListener('loadstart', function (ev) {
        // this fires when the request starts,
        // but shouldn't fire until the request has loaded
        // and the response starts
        req.emit('loadstart', ev);
        resetTimeout();
    });
    xhr2.addEventListener('progress', function (ev) {
        if (!req.loaded) {
          req.loaded = true;
          req.emit('progress', {});
          req.emit('load', {});
        }
        if (!res.loadstart) {
          res.headers = xhr2.getAllResponseHeaders();
          res.loadstart = true;
          res.emit('loadstart', ev);
        }
        res.emit('progress', ev);
        resetTimeout();
    });
    xhr2.addEventListener('load', function (ev) {
      if (xhr2.status >= 400) {
        ev.error = new Error(xhr2.status);
      }
      ev.target.result = encodeData(options, xhr2);
      res.emit('load', ev);
    });
    /*
    xhr2Request.addEventListener('loadstart', function (ev) {
      req.emit('loadstart', ev);
      resetTimeout();
    });
    */
    xhr2Request.addEventListener('load', function (ev) {
      resetTimeout();
      req.emit('load', ev);
      res.loadstart = true;
      res.emit('loadstart', {});
    });
    xhr2Request.addEventListener('progress', function (ev) {
      resetTimeout();
      req.emit('progress', ev);
    });


    /* Error States */
    xhr2.addEventListener('abort', function (ev) {
      res.emit('abort', ev);
    });
    xhr2Request.addEventListener('abort', function (ev) {
      req.emit('abort', ev);
    });
    xhr2.addEventListener('error', function (ev) {
      res.emit('error', ev);
    });
    xhr2Request.addEventListener('error', function (ev) {
      req.emit('error', ev);
    });
    // the "Request" is what timeouts
    // the "Response" will timeout as well
    xhr2.addEventListener('timeout', function (ev) {
      req.emit('timeout', ev);
    });
    xhr2Request.addEventListener('timeout', function (ev) {
      req.emit('timeout', ev);
    });

    /* Cleanup */
    res.on('loadend', function () {
      // loadend is managed by AHR
      clearTimeout(timeoutToken);
    });

    if (options.username) {
      xhr2.open(options.method, options.href, true, options.username, options.password);
    } else {
      xhr2.open(options.method, options.href, true);
    }

    Object.keys(options.headers).forEach(sanatizeHeaders);

    setTimeout(function () {
      if ('binary' === options.overrideResponseType) {
        xhr2.overrideMimeType("text/plain; charset=x-user-defined");
      }
      try {
        xhr2.send(options.encodedBody);
      } catch(e) {
        req.emit('error', e);
      }
    }, 1);
    

    req.abort = function () {
      xhr2.abort();
    };
    res.abort = function () {
      xhr2.abort();
    };

    res.browserRequest = xhr2;
    return res;
  }

  function send(req, res) {
    var options = req.userOptions;
    console.log('options', options);
    if (options.jsonp && options.jsonpCallback) {
      return browserJsonpClient(req, res);
    }
    return browserHttpClient(req, res);
  }

  module.exports = send;

  provide('browser-request', module.exports);
}());