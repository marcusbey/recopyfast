(function() {
  'use strict';

  // TOMBSTONE — security audit H3 (s127). Direct `document.currentScript`
  // access is clobberable by named customer markup. That let an image choose
  // the executable URL below, while two images threw into the host page. Use
  // the platform getter and require a real script before copying anything.
  var current;
  try {
    current = Object.getOwnPropertyDescriptor(Document.prototype, 'currentScript').get.call(document);
    if (!(current instanceof HTMLScriptElement)) return;
  } catch (e) { return; }
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
    // Browsers may hide a nonce's attribute value while keeping `.nonce`.
    if (current.nonce) script.nonce = current.nonce;
  }

  if (current && current.parentNode) {
    current.parentNode.insertBefore(script, current.nextSibling);
  } else {
    document.head.appendChild(script);
  }
})();
