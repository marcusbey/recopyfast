(function() {
  'use strict';

  var current = document.currentScript;
  var script = document.createElement('script');
  var src = current && current.src
    ? current.src.replace(/\/recopyfast-secure\.js(\?.*)?$/, '/recopyfast.js$1')
    : '/embed/recopyfast.js';

  script.src = src;
  script.async = true;

  if (current) {
    Array.prototype.forEach.call(current.attributes, function(attribute) {
      if (attribute.name !== 'src') {
        script.setAttribute(attribute.name, attribute.value);
      }
    });
  }

  if (current && current.parentNode) {
    current.parentNode.insertBefore(script, current.nextSibling);
  } else {
    document.head.appendChild(script);
  }
})();
