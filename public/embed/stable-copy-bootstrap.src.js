(function () {
  "use strict";

  var STATE_KEY = "__rcfStartup";
  var HELD_ATTRIBUTE = "data-rcf-startup-held";
  var STYLE_ATTRIBUTE = "data-rcf-startup-style";
  var DEADLINE_MS = 200;
  var COMMIT_SAFETY_MS = 8;
  var GATE_STYLE = "__RCF_STABLE_COPY_GATE_STYLE__";
  var ELIGIBLE_SELECTOR =
    "h1,h2,h3,h4,h5,h6,p,span,li,td,th,label,button," +
    "a.rcf-editable-link,div[data-rcf-content]";
  var EXCLUDED_SELECTOR =
    '[data-rcf-ignore],[contenteditable]:not([contenteditable="false"]),' +
    "#rcf-staging-banner,#rcf-edit-board,.rcf-overlay";

  // Terminal reason codes cross the inline/external boundary and stay compact
  // for the hard bootstrap budget: c=config, s=style, d=deadline, x=exception,
  // l=late, e=empty, n=content, a=applied, p=private, r=runtime mismatch.

  function normalizedPagePath(documentRef) {
    var pathname = documentRef.location.pathname;
    try {
      pathname = decodeURI(pathname);
    } catch (_error) {
      // A malformed escape remains distinct instead of breaking the host page.
    }
    return pathname.replace(/(?:\/index\.html?|\/+)$/i, "") || "/";
  }

  function start() {
    var documentRef = document;
    var windowRef = window;
    var script = documentRef.currentScript;
    var protocol = script && script.getAttribute("data-rcf-startup");
    var siteId = script && script.getAttribute("data-site-id");
    var siteToken = script && script.getAttribute("data-site-token");
    var apiUrl = script && script.getAttribute("data-api-url");
    var nonce = (script && script.nonce) || "";
    var pagePath = normalizedPagePath(documentRef);
    // One exact binding lets the external runtime reject a mismatched
    // bootstrap without repeating four public property names in every head.
    var binding = protocol + "\0" + siteId + "\0" + apiUrl + "\0" + pagePath;
    var existing = windowRef[STATE_KEY];

    if (existing) {
      if (existing.k !== binding) {
        if (typeof existing.fail === "function") {
          existing.fail("c");
        }
      }
      return;
    }

    var held = new Set();
    var styledRoots = [];
    var observers = [];
    var timer = null;
    var controller =
      typeof AbortController === "function" ? new AbortController() : null;
    var nativeAttach = null;
    var startupAttach = null;

    var state = {
      k: binding,
      status: "a",
      code: null,
      at: null,
      fail: function (reason) {
        settle("f", reason, true);
      },
      drop: function (reason) {
        settle("p", reason, true);
      },
      done: function () {
        settle("d", "a", false);
      },
      can: function () {
        return (
          (state.status === "a" || state.status === "h") &&
          (state.at === null || performance.now() - state.at <= DEADLINE_MS)
        );
      },
      snap: capture,
      limit: DEADLINE_MS - COMMIT_SAFETY_MS,
      apply: commit,
    };
    windowRef[STATE_KEY] = state;

    function cleanup() {
      if (timer !== null) clearTimeout(timer);
      timer = null;

      for (var index = 0; index < observers.length; index += 1) {
        observers[index].disconnect();
      }
      observers = [];
      if (Element.prototype.attachShadow === startupAttach) {
        Element.prototype.attachShadow = nativeAttach;
      }

      held.forEach(function (element) {
        element.removeAttribute(HELD_ATTRIBUTE);
      });
      held.clear();

      for (var rootIndex = 0; rootIndex < styledRoots.length; rootIndex += 1) {
        var root = styledRoots[rootIndex];
        var style = root.querySelector("style[" + STYLE_ATTRIBUTE + "]");
        if (style) style.remove();
      }
    }

    function settle(status, reason, shouldAbort) {
      if (state.status !== "a" && state.status !== "h") return;

      state.status = status;
      state.code = reason;
      if (shouldAbort && controller) controller.abort();
      cleanup();
    }

    function installStyle(root) {
      if (root.querySelector("style[" + STYLE_ATTRIBUTE + "]")) {
        return true;
      }

      var style = documentRef.createElement("style");
      style.setAttribute(STYLE_ATTRIBUTE, "");
      if (nonce) style.nonce = nonce;
      style.textContent = GATE_STYLE;

      try {
        root.appendChild(style);
      } catch (_error) {
        return false;
      }

      // A CSP-blocked style remains in the DOM but owns no stylesheet. Check
      // the document copy once; the same nonce/hash policy governs open roots.
      if (root === documentRef.head && !style.sheet) {
        style.remove();
        return false;
      }

      styledRoots.push(root);
      return true;
    }

    function isEligible(element) {
      if (
        !element ||
        element.nodeType !== 1 ||
        !element.matches(ELIGIBLE_SELECTOR) ||
        element.closest(EXCLUDED_SELECTOR)
      ) {
        return false;
      }

      if (element.hasAttribute("data-rcf-content")) return true;

      for (var index = 0; index < element.childNodes.length; index += 1) {
        var node = element.childNodes[index];
        if (node.nodeType === 3 && node.textContent.trim()) {
          return element.textContent.trim().length >= 2;
        }
      }
      return false;
    }

    function hold(element) {
      if (!isEligible(element) || !state.can()) return;

      if (held.has(element)) {
        if (
          element.isConnected &&
          windowRef.getComputedStyle(element).visibility !== "hidden"
        ) {
          state.fail("s");
        }
        return;
      }

      element.setAttribute(HELD_ATTRIBUTE, "");
      held.add(element);

      // A stronger host !important rule can beat the attribute selector. That
      // installation is unsupported, so release authored copy and lock out the
      // late public swap instead of claiming a gate that never hid anything.
      if (
        element.isConnected &&
        windowRef.getComputedStyle(element).visibility !== "hidden"
      ) {
        state.fail("s");
        return;
      }

      if (state.status === "a") {
        state.status = "h";
        state.at = performance.now();
        timer = setTimeout(function () {
          // Keep the already-started public GET alive after text falls back.
          // Stored images retain their legacy late hydration, while `i` makes
          // the runtime reject text, A/B, socket and polling mutations.
          state.i = true;
          settle("f", "d", false);
        }, DEADLINE_MS);
      }
    }

    function capture(widget) {
      var snapshots = [];
      widget.elements.forEach(function (data) {
        var target = data.element;
        var picture =
          target.tagName === "IMG" &&
          target.parentElement &&
          target.parentElement.tagName === "PICTURE"
            ? target.parentElement
            : null;
        snapshots.push({
          data: data,
          shell: target.cloneNode(false),
          value:
            target.tagName === "INPUT" || target.tagName === "TEXTAREA"
              ? target.value
              : null,
          childNodes: Array.from(target.childNodes),
          originalContent: data.originalContent,
          sources: picture
            ? Array.from(picture.querySelectorAll("source"))
            : null,
        });
      });
      return snapshots;
    }

    function commit(widget, rows, includeVariants, snapshots) {
      if (!state.can()) {
        state.fail("d");
        return null;
      }

      try {
        widget.applyStoredContent(rows);
        var shown = includeVariants ? widget.applyVariants() : [];
        if (!state.can()) throw new Error("d");
        return shown;
      } catch (_error) {
        for (
          var snapshotIndex = snapshots.length - 1;
          snapshotIndex >= 0;
          snapshotIndex -= 1
        ) {
          var snapshot = snapshots[snapshotIndex];
          var target = snapshot.data.element;
          try {
            Array.from(target.attributes).forEach(function (attribute) {
              target.removeAttribute(attribute.name);
            });
            Array.from(snapshot.shell.attributes).forEach(function (attribute) {
              target.setAttribute(attribute.name, attribute.value);
            });
            if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
              target.value = snapshot.value;
            } else {
              target.replaceChildren.apply(target, snapshot.childNodes);
            }
            snapshot.data.originalContent = snapshot.originalContent;
            if (snapshot.sources && target.parentElement) {
              Array.from(
                target.parentElement.querySelectorAll("source"),
              ).forEach(function (source) {
                source.remove();
              });
              for (
                var sourceIndex = 0;
                sourceIndex < snapshot.sources.length;
                sourceIndex += 1
              ) {
                target.parentElement.insertBefore(
                  snapshot.sources[sourceIndex],
                  target,
                );
              }
            }
          } catch (_restoreError) {
            // Continue restoring earlier elements after a hostile host setter.
          }
        }
        state.fail("x");
        return null;
      }
    }

    function scan(node) {
      if (!node) return;

      if (node.nodeType === 3) {
        hold(node.parentElement);
        return;
      }

      if (node.nodeType === 1) {
        hold(node);
        if (node.shadowRoot) gateRoot(node.shadowRoot);
      }

      if (!node.querySelectorAll) return;
      var descendants = node.querySelectorAll("*");
      for (var index = 0; index < descendants.length; index += 1) {
        hold(descendants[index]);
        if (descendants[index].shadowRoot) {
          gateRoot(descendants[index].shadowRoot);
        }
      }
    }

    function gateRoot(root) {
      if (!state.can()) return;
      var wasStyled = styledRoots.includes(root);
      if (!installStyle(root)) {
        state.fail("s");
        return;
      }

      scan(root);
      if (wasStyled || !state.can()) return;
      var observer = new MutationObserver(function (mutations) {
        if (!installStyle(root)) {
          state.fail("s");
          return;
        }
        for (var index = 0; index < mutations.length; index += 1) {
          var added = mutations[index].addedNodes;
          for (var addedIndex = 0; addedIndex < added.length; addedIndex += 1) {
            scan(added[addedIndex]);
          }
        }
      });
      observer.observe(root, { childList: true, subtree: true });
      observers.push(observer);
    }

    // A bootstrap that ran after <body> cannot protect the first paint. Mark it
    // terminal before any request or observer can create a legacy late swap.
    if (
      !script ||
      protocol !== "2" ||
      !siteId ||
      !siteToken ||
      !apiUrl ||
      documentRef.body
    ) {
      state.status = "f";
      state.code = "l";
      return;
    }

    nativeAttach = Element.prototype.attachShadow;
    startupAttach = function (options) {
      var root = nativeAttach.call(this, options);
      if (options && options.mode === "open") gateRoot(root);
      return root;
    };
    Element.prototype.attachShadow = startupAttach;

    if (!installStyle(documentRef.head || documentRef.documentElement)) {
      state.fail("s");
      return;
    }

    var documentObserver = new MutationObserver(function (mutations) {
      for (var index = 0; index < mutations.length; index += 1) {
        var added = mutations[index].addedNodes;
        for (var addedIndex = 0; addedIndex < added.length; addedIndex += 1) {
          scan(added[addedIndex]);
        }
      }
    });
    documentObserver.observe(documentRef.documentElement, {
      childList: true,
      subtree: true,
    });
    observers.push(documentObserver);

    documentRef.addEventListener(
      "DOMContentLoaded",
      function () {
        scan(documentRef.body);
        if (held.size === 0 && state.status === "a") {
          state.i = true;
          settle("f", "e", false);
        }
      },
      { once: true },
    );

    // Recovery is armed above before this request begins. Cross-origin reads
    // leak no referrer; same-origin reads send only the origin root so the API
    // can prove the request came from the installed customer host.
    if (typeof windowRef.fetch !== "function") {
      state.fail("n");
      state.content = Promise.resolve(null);
      return;
    }

    var endpoint =
      apiUrl +
      "/content/" +
      encodeURIComponent(siteId) +
      "?page_path=" +
      encodeURIComponent(pagePath);
    // URL parsing deliberately stays inside the outer fail-safe: malformed
    // trusted configuration releases the gate without issuing a request.
    var origin = documentRef.location.origin;
    var sameOrigin = new URL(apiUrl).origin === origin;
    var request = {
      headers: { Authorization: "Bearer " + siteToken },
      credentials: "omit",
      referrerPolicy: sameOrigin ? "origin" : "no-referrer",
    };
    // Same-origin site authorization needs a host signal. Send only the origin
    // root; path/query/hash and editor parameters remain excluded.
    if (sameOrigin) request.referrer = origin + "/";
    if (controller) request.signal = controller.signal;

    state.content = windowRef
      .fetch(endpoint, request)
      .then(function (response) {
        if (!response.ok) throw new Error(response.status);
        return response.json();
      })
      .catch(function () {
        state.fail("n");
        return null;
      });
  }

  try {
    start();
  } catch (_error) {
    var state = window[STATE_KEY];
    if (state && typeof state.fail === "function") {
      state.fail("x");
    }
  }
})();
