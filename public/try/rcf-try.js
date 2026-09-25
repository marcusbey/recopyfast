(function () {
  "use strict";

  if (window.__rcfTryPreview) {
    window.__rcfTryPreview.resume();
    return;
  }
  if (!document.head || !document.body) return;

  var script = document.currentScript;
  var selector = script && script.getAttribute("data-rcf-try-root");
  var root;

  function resolveRoot() {
    if (!selector) return document.body;
    // The /try sample scopes this script so its own marketing navigation never
    // becomes editable. A stale or malformed selector must therefore fail
    // closed instead of silently widening the preview to the entire page.
    try {
      return document.querySelector(selector);
    } catch (_) {
      return null;
    }
  }

  root = resolveRoot();
  if (!root) return;

  var active = null;
  var listeners = [];
  var ownedAttributes = new Map();
  var ui = [];
  var toolbarNode = null;
  var statusNode = null;

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function append(parent) {
    for (var i = 1; i < arguments.length; i += 1) {
      parent.appendChild(arguments[i]);
    }
    return parent;
  }

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    listeners.push([target, type, handler, options]);
  }

  function ownAttribute(target, name, value) {
    var records = ownedAttributes.get(target);
    if (!records) {
      records = new Map();
      ownedAttributes.set(target, records);
    }
    if (!records.has(name)) records.set(name, target.getAttribute(name));
    target.setAttribute(name, value);
  }

  function restoreAttribute(target, name) {
    var records = ownedAttributes.get(target);
    if (!records || !records.has(name)) return;
    var original = records.get(name);
    if (original === null) target.removeAttribute(name);
    else target.setAttribute(name, original);
    records.delete(name);
    if (!records.size) ownedAttributes.delete(target);
  }

  function onlyEditableContentIsLink(candidate) {
    var links = candidate.querySelectorAll("a");
    if (links.length !== 1) return false;
    var link = links[0];
    var hasOtherContent = false;

    function inspect(node) {
      if (hasOtherContent || node === link) return;
      if (node.nodeType === 3) {
        if (String(node.nodeValue || "").trim()) hasOtherContent = true;
        return;
      }
      if (node.nodeType !== 1) return;
      if (
        node.matches(
          "button,img,input,select,textarea,video,audio,canvas,svg,iframe",
        )
      ) {
        hasOtherContent = true;
        return;
      }
      for (var i = 0; i < node.childNodes.length; i += 1)
        inspect(node.childNodes[i]);
    }

    for (var i = 0; i < candidate.childNodes.length; i += 1)
      inspect(candidate.childNodes[i]);
    return !hasOtherContent;
  }

  function candidateFrom(eventTarget, altKey) {
    var target =
      eventTarget && eventTarget.nodeType === 1
        ? eventTarget
        : eventTarget && eventTarget.parentElement;
    if (!target || target.closest("[data-rcf-try-ui]")) return null;
    // A link always keeps its native plain click. Alt selects its text target,
    // keeping direct anchors consistent while preserving precise block labels
    // and their inline formatting inside linked cards.
    var link = target.closest("a");
    if (link && !root.contains(link)) link = null;
    var candidate = target.closest("h1,h2,h3,h4,h5,h6,p,li,button,img");
    if (link && altKey) {
      // Block labels wrapped by a link keep their precise edit target and
      // click-point caret. Direct and inline links still edit the anchor.
      if (candidate && candidate !== link && link.contains(candidate))
        return candidate;
      return link;
    }
    if (link) return null;
    if (!candidate) candidate = target.closest("a");
    if (!candidate || !root.contains(candidate)) return null;
    // A no-nav mega menu exposes its <li> padding as the nearest supported
    // target. Preserve that menu surface when a direct link sits beside a
    // submenu panel, without disabling ordinary prose list items that happen
    // to contain an inline link.
    if (candidate.tagName === "LI") {
      var hasDirectLink = false;
      var hasPanel = false;
      for (
        var child = candidate.firstElementChild;
        child;
        child = child.nextElementSibling
      ) {
        if (child.tagName === "A") hasDirectLink = true;
        else if (child.matches("div,ul,ol,[role='menu']")) hasPanel = true;
      }
      if (hasDirectLink && hasPanel) return null;
    }
    if (onlyEditableContentIsLink(candidate)) return null;
    return candidate;
  }

  function isNavigationLink(target) {
    return (
      target.tagName === "A" &&
      Boolean(target.closest("nav,[role='navigation']"))
    );
  }

  var style = element("style");
  style.id = "rcf-try-style";
  style.setAttribute("data-rcf-try-ui", "true");
  style.textContent =
    "[data-rcf-try-hover]{outline:2px solid #0d9488!important;outline-offset:3px!important;cursor:pointer!important}" +
    "[data-rcf-try-editing]{outline:2px solid #0284c7!important;outline-offset:3px!important;cursor:text!important}" +
    '#rcf-try-topbar,[data-rcf-try-ui].rcf-try-toolbar,[data-rcf-try-ui].rcf-try-status{box-sizing:border-box!important;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;z-index:2147483647!important;color:#0f172a!important}' +
    "#rcf-try-topbar{position:fixed!important;inset:0 0 auto!important;min-height:48px!important;padding:8px 14px!important;background:#0f172a!important;color:#fff!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:12px!important;flex-wrap:wrap!important;box-shadow:0 2px 12px #0004!important;font-size:14px!important;line-height:1.3!important}" +
    "#rcf-try-topbar a{color:#67e8f9!important;font-weight:700!important;text-decoration:none!important}" +
    "#rcf-try-topbar button,[data-rcf-try-ui].rcf-try-toolbar button{border:1px solid #cbd5e1!important;border-radius:7px!important;background:#fff!important;color:#0f172a!important;padding:7px 11px!important;font:600 13px/1 ui-sans-serif,system-ui,sans-serif!important;cursor:pointer!important}" +
    "#rcf-try-topbar button{border-color:#475569!important;background:#1e293b!important;color:#fff!important}" +
    "[data-rcf-try-ui].rcf-try-toolbar{position:fixed!important;left:50%!important;bottom:24px!important;transform:translateX(-50%)!important;width:max-content!important;max-width:calc(100vw - 24px)!important;padding:9px!important;background:#fff!important;border:1px solid #cbd5e1!important;border-radius:10px!important;display:flex!important;align-items:center!important;gap:8px!important;flex-wrap:wrap!important;box-shadow:0 8px 30px #0f172a33!important}" +
    "[data-rcf-try-ui].rcf-try-toolbar .rcf-try-primary{background:#0d9488!important;border-color:#0d9488!important;color:#fff!important}" +
    "[data-rcf-try-ui].rcf-try-toolbar label{font-size:12px!important;font-weight:700!important}" +
    "[data-rcf-try-ui].rcf-try-toolbar input{box-sizing:border-box!important;min-width:min(330px,calc(100vw - 48px))!important;max-width:100%!important;border:1px solid #94a3b8!important;border-radius:7px!important;padding:7px 9px!important;background:#fff!important;color:#0f172a!important;font:13px/1.2 ui-sans-serif,system-ui,sans-serif!important}" +
    ".rcf-try-error{width:100%!important;color:#b91c1c!important;font-size:12px!important}" +
    "[data-rcf-try-ui].rcf-try-status{position:fixed!important;right:16px!important;bottom:16px!important;max-width:calc(100vw - 32px)!important;padding:8px 11px!important;border-radius:999px!important;background:#ccfbf1!important;border:1px solid #5eead4!important;color:#115e59!important;font-size:12px!important;font-weight:700!important;box-shadow:0 4px 18px #0f172a22!important}";
  document.head.appendChild(style);
  ui.push(style);

  var message = element(
    "span",
    "rcf-try-message",
    "ReCopyFast preview — edits stay in this tab. Nothing is saved to this site.",
  );
  var linkHint = element(
    "span",
    "rcf-try-link-hint",
    "Alt+click a link to edit it",
  );
  var signup = element("a", "rcf-try-signup", "Get this on your site →");
  signup.id = "rcf-try-signup";
  signup.href =
    "https://www.recopyfa.st/signup?utm_source=try&utm_medium=bookmarklet";
  signup.target = "_blank";
  signup.rel = "noopener noreferrer";
  var exitButton = element("button", "rcf-try-exit", "Exit");
  exitButton.id = "rcf-try-exit";
  exitButton.type = "button";
  var topbar = append(
    element("div", "rcf-try-topbar"),
    message,
    linkHint,
    signup,
    exitButton,
  );
  topbar.id = "rcf-try-topbar";
  topbar.setAttribute("data-rcf-try-ui", "true");
  document.body.appendChild(topbar);
  ui.push(topbar);

  function clearToolbar() {
    if (toolbarNode) toolbarNode.remove();
    toolbarNode = null;
  }

  function showStatus(target) {
    if (!statusNode) {
      statusNode = element("div", "rcf-try-status", "Published (preview)");
      statusNode.setAttribute("data-rcf-try-ui", "true");
      document.body.appendChild(statusNode);
      ui.push(statusNode);
    } else if (!statusNode.isConnected) {
      document.body.appendChild(statusNode);
    }
    ownAttribute(target, "data-rcf-try-published", "true");
  }

  function snapshotTree(node) {
    var children = Array.prototype.slice.call(node.childNodes);
    return {
      node: node,
      children: children,
      snapshots: children.map(function (child) {
        return child.nodeType === 1
          ? snapshotTree(child)
          : { node: child, value: child.nodeValue };
      }),
    };
  }

  function restoreTree(snapshot) {
    for (var i = 0; i < snapshot.snapshots.length; i += 1) {
      var child = snapshot.snapshots[i];
      if (child.children) restoreTree(child);
      else child.node.nodeValue = child.value;
    }
    snapshot.node.replaceChildren.apply(snapshot.node, snapshot.children);
  }

  function finishEditing() {
    if (!active) return;
    restoreAttribute(active.element, "contenteditable");
    restoreAttribute(active.element, "spellcheck");
    restoreAttribute(active.element, "data-rcf-try-editing");
    active = null;
    clearToolbar();
  }

  function cancel() {
    if (!active) return;
    if (active.type === "text") restoreTree(active.originalTree);
    finishEditing();
  }

  function saveText() {
    if (!active || active.type !== "text") return;
    var target = active.element;
    finishEditing();
    showStatus(target);
  }

  function isRasterDataUrl(value) {
    return /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/]+={0,2}$/i.test(
      value,
    );
  }

  function saveImageValue(value, error) {
    if (!active || active.type !== "image") return;
    // A normal https image URL would make the host page perform a new request,
    // contradicting the preview's local-only promise. Raster data URLs keep
    // replacement bytes in this tab and also exclude executable SVG payloads.
    if (!isRasterDataUrl(value)) {
      error.textContent =
        "Use an embedded raster data URL (PNG, JPEG, GIF, WebP or AVIF).";
      return;
    }
    var target = active.element;
    target.setAttribute("src", value);
    // Responsive candidates override img.src in real browsers. Disable them as
    // part of the saved local DOM edit and leave that edit intact on Exit, just
    // like saved text, so the selected preview image remains visible.
    if (target.hasAttribute("srcset")) target.setAttribute("srcset", "");
    var picture = target.closest("picture");
    if (picture) {
      var sources = picture.querySelectorAll("source[srcset]");
      for (var i = 0; i < sources.length; i += 1) {
        sources[i].setAttribute("srcset", "");
      }
    }
    finishEditing();
    showStatus(target);
  }

  function saveImage(input, error) {
    saveImageValue(input.value.trim(), error);
  }

  function textToolbar() {
    var save = element("button", "rcf-try-primary", "Save");
    save.type = "button";
    save.setAttribute("data-rcf-try-action", "save-text");
    var cancelButton = element("button", "", "Cancel");
    cancelButton.type = "button";
    cancelButton.setAttribute("data-rcf-try-action", "cancel");
    return append(element("div", "rcf-try-toolbar"), save, cancelButton);
  }

  function imageToolbar() {
    var fileLabel = element("label", "", "Choose a local image");
    var fileInput = element("input");
    fileInput.type = "file";
    fileInput.accept = "image/png,image/jpeg,image/gif,image/webp,image/avif";
    fileInput.setAttribute("data-rcf-try-file", "true");
    fileLabel.appendChild(fileInput);
    var label = element("label", "", "Image data URL");
    var input = element("input");
    input.type = "url";
    input.placeholder = "data:image/png;base64,…";
    label.appendChild(input);
    var replace = element("button", "rcf-try-primary", "Replace image");
    replace.type = "button";
    replace.setAttribute("data-rcf-try-action", "save-image");
    var cancelButton = element("button", "", "Cancel");
    cancelButton.type = "button";
    cancelButton.setAttribute("data-rcf-try-action", "cancel");
    var error = element("div", "rcf-try-error");
    error.setAttribute("aria-live", "polite");
    return append(
      element("div", "rcf-try-toolbar"),
      fileLabel,
      label,
      replace,
      cancelButton,
      error,
    );
  }

  function mountToolbar(toolbar) {
    toolbar.setAttribute("data-rcf-try-ui", "true");
    toolbar.setAttribute("role", "dialog");
    toolbar.setAttribute("aria-label", "ReCopyFast preview editor");
    document.body.appendChild(toolbar);
    toolbarNode = toolbar;
  }

  function placeCaret(target, event) {
    var range = null;
    if (document.caretPositionFromPoint) {
      var position = document.caretPositionFromPoint(
        event.clientX,
        event.clientY,
      );
      if (position) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
      }
    } else if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(event.clientX, event.clientY);
    }
    if (!range || !target.contains(range.startContainer)) return;
    range.collapse(true);
    var selection = window.getSelection && window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function startText(target, event) {
    cancel();
    active = {
      type: "text",
      element: target,
      // Keep the actual inline nodes in place during editing. The recursive
      // snapshot lets Cancel restore those same node identities and handlers,
      // even after contenteditable has restructured or removed descendants.
      originalTree: snapshotTree(target),
    };
    ownAttribute(target, "contenteditable", "plaintext-only");
    ownAttribute(target, "spellcheck", "true");
    ownAttribute(target, "data-rcf-try-editing", "true");
    mountToolbar(textToolbar());
    target.focus();
    placeCaret(target, event);
  }

  function startImage(target) {
    cancel();
    active = {
      type: "image",
      element: target,
    };
    ownAttribute(target, "data-rcf-try-editing", "true");
    var toolbar = imageToolbar();
    mountToolbar(toolbar);
    toolbar.querySelector("input").focus();
  }

  function insertPlainText(text) {
    if (!active || active.type !== "text") return;
    var target = active.element;
    var selection = window.getSelection && window.getSelection();
    if (selection && selection.rangeCount) {
      var range = selection.getRangeAt(0);
      if (target.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        var textNode = document.createTextNode(text);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
    }
    target.appendChild(document.createTextNode(text));
  }

  function onMouseOver(event) {
    var target = candidateFrom(event.target, event.altKey);
    if (!target || target === (active && active.element)) return;
    if (isNavigationLink(target) && !event.altKey) return;
    ownAttribute(target, "data-rcf-try-hover", "true");
  }

  function onMouseOut(event) {
    var target =
      event.target.closest && event.target.closest("[data-rcf-try-hover]");
    if (target) restoreAttribute(target, "data-rcf-try-hover");
  }

  function clearLinkHover() {
    var hovered = document.querySelectorAll("a[data-rcf-try-hover]");
    for (var i = 0; i < hovered.length; i += 1)
      restoreAttribute(hovered[i], "data-rcf-try-hover");
  }

  function isBlockContainer(target) {
    var display = window.getComputedStyle
      ? window.getComputedStyle(target).display
      : "";
    return (
      /^(?:block|flow-root|flex|grid|list-item|table|inline-block|inline-flex|inline-grid|table-cell|table-caption|table-row|table-row-group|table-header-group|table-footer-group)$/.test(
        display,
      ) ||
      target.matches(
        "address,article,aside,blockquote,div,dl,fieldset,figure,footer,form,header,li,main,nav,ol,pre,section,table,ul",
      )
    );
  }

  function boundedInteractiveAncestorContains(target) {
    if (!active) return false;
    // A card link can contain block wrappers between the editable heading and
    // the clickable padding. Compare only the edited element's own nearest
    // link so this exception cannot grow into a page-wide ancestor walk.
    var activeLink = null;
    var linkAncestor = active.element.parentElement;
    var linkDepth = 0;
    while (
      linkAncestor &&
      linkDepth < 4 &&
      linkAncestor !== root &&
      linkAncestor !== document.body &&
      linkAncestor !== document.documentElement &&
      root.contains(linkAncestor)
    ) {
      if (linkAncestor.tagName === "A") {
        activeLink = linkAncestor;
        break;
      }
      linkDepth += 1;
      linkAncestor = linkAncestor.parentElement;
    }
    if (activeLink && activeLink.contains(target)) return true;
    var ancestor = active.element.parentElement;
    var depth = 0;
    while (
      ancestor &&
      depth < 4 &&
      ancestor !== root &&
      ancestor !== document.body &&
      ancestor !== document.documentElement &&
      root.contains(ancestor)
    ) {
      var isBlock = isBlockContainer(ancestor);
      if (isBlock && !ancestor.matches("a,button,[role='button']")) break;
      if (
        ancestor.matches("a,[onclick],[role='button']") &&
        ancestor.contains(target)
      )
        return true;
      depth += 1;
      if (isBlock) break;
      ancestor = ancestor.parentElement;
    }
    return false;
  }

  function onClick(event) {
    var action =
      event.target.closest && event.target.closest("[data-rcf-try-action]");
    if (action && (!toolbarNode || !toolbarNode.contains(action)))
      action = null;
    if (action) {
      event.preventDefault();
      event.stopImmediatePropagation();
      var name = action.getAttribute("data-rcf-try-action");
      if (name === "cancel") cancel();
      else if (name === "save-text") saveText();
      else if (name === "save-image") {
        var toolbar = action.closest(".rcf-try-toolbar");
        saveImage(
          toolbar.querySelector("input[type='url']"),
          toolbar.querySelector(".rcf-try-error"),
        );
      }
      return;
    }
    if (event.target.closest && event.target.closest("[data-rcf-try-ui]"))
      return;
    if (active) {
      if (
        active.element.contains(event.target) ||
        boundedInteractiveAncestorContains(event.target)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
    }
    var target = candidateFrom(event.target, event.altKey);
    if (!target || (isNavigationLink(target) && !event.altKey)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    restoreAttribute(target, "data-rcf-try-hover");
    if (target.tagName === "IMG") startImage(target);
    else startText(target, event);
  }

  function onChange(event) {
    if (!active || active.type !== "image") return;
    var input = event.target;
    if (!input.matches || !input.matches("[data-rcf-try-file]")) return;
    event.stopImmediatePropagation();
    var toolbar = input.closest(".rcf-try-toolbar");
    var error = toolbar.querySelector(".rcf-try-error");
    var file = input.files && input.files[0];
    if (!file) {
      error.textContent = "Choose a PNG, JPEG, GIF, WebP or AVIF image.";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      error.textContent = "Choose an image that is 5 MB or smaller.";
      return;
    }
    if (!file.size) {
      error.textContent =
        "That image is empty or corrupt. Choose another file.";
      return;
    }
    if (
      !/^(?:image\/png|image\/jpeg|image\/gif|image\/webp|image\/avif)$/i.test(
        file.type,
      )
    ) {
      error.textContent = "Choose a PNG, JPEG, GIF, WebP or AVIF image.";
      return;
    }
    var reader = new FileReader();
    var editingSession = active;
    reader.onerror = function () {
      error.textContent =
        "That image is empty or corrupt. Choose another file.";
    };
    reader.onload = function () {
      if (active !== editingSession) return;
      var value = String(reader.result || "");
      var decoded = new Image();
      decoded.onerror = function () {
        if (active === editingSession)
          error.textContent =
            "That image is empty or corrupt. Choose another file.";
      };
      decoded.onload = function () {
        if (active === editingSession) saveImageValue(value, error);
      };
      decoded.src = value;
    };
    reader.readAsDataURL(file);
  }

  function onPaste(event) {
    if (
      !active ||
      active.type !== "text" ||
      !active.element.contains(event.target)
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    insertPlainText(
      (event.clipboardData && event.clipboardData.getData("text/plain")) || "",
    );
  }

  function onDrop(event) {
    if (
      !active ||
      active.type !== "text" ||
      !active.element.contains(event.target)
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    insertPlainText(
      (event.dataTransfer && event.dataTransfer.getData("text/plain")) || "",
    );
  }

  function onInput(event) {
    if (active && active.type === "text" && event.target === active.element) {
      event.stopImmediatePropagation();
    }
  }

  function onKeyDown(event) {
    if (event.key === "Escape" && active) {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    } else if (
      active &&
      active.type === "text" &&
      active.element.contains(event.target)
    ) {
      if (
        !event.isComposing &&
        (event.key === " " ||
          event.key === "Spacebar" ||
          event.key === "Enter") &&
        (active.element.matches("a,button,[role='button']") ||
          boundedInteractiveAncestorContains(active.element))
      ) {
        event.preventDefault();
        insertPlainText(event.key === "Enter" ? "\n" : " ");
      }
      event.stopImmediatePropagation();
    }
  }

  function onActivationKey(event) {
    if (
      active &&
      active.type === "text" &&
      active.element.contains(event.target) &&
      !event.isComposing &&
      (active.element.matches("a,button,[role='button']") ||
        boundedInteractiveAncestorContains(active.element)) &&
      (event.key === " " || event.key === "Spacebar" || event.key === "Enter")
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function onKeyUp(event) {
    onActivationKey(event);
    if (event.key === "Alt") clearLinkHover();
  }

  function onSubmit(event) {
    if (active && active.element.closest("form") === event.target) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function exit() {
    cancel();
    for (var i = 0; i < listeners.length; i += 1) {
      listeners[i][0].removeEventListener(
        listeners[i][1],
        listeners[i][2],
        listeners[i][3],
      );
    }
    listeners.length = 0;
    ownedAttributes.forEach(function (records, target) {
      records.forEach(function (original, name) {
        if (original === null) target.removeAttribute(name);
        else target.setAttribute(name, original);
      });
    });
    ownedAttributes.clear();
    for (var j = 0; j < ui.length; j += 1) ui[j].remove();
    ui.length = 0;
    clearToolbar();
    statusNode = null;
    delete window.__rcfTryPreview;
  }

  function resume() {
    if (!document.head || !document.body) return false;
    var nextRoot = resolveRoot();
    if (!nextRoot) return false;
    root = nextRoot;
    if (active && !active.element.isConnected) {
      // History restorations clone markup but not node identity. Restore every
      // clone marked as the active edit from the originals recorded for the
      // live node; removing contenteditable blindly would corrupt host-owned
      // editors that were editable before the preview started.
      var records = ownedAttributes.get(active.element);
      var restoredEdits = document.querySelectorAll("[data-rcf-try-editing]");
      for (var i = 0; i < restoredEdits.length; i += 1) {
        if (records) {
          records.forEach(function (original, name) {
            if (original === null) restoredEdits[i].removeAttribute(name);
            else restoredEdits[i].setAttribute(name, original);
          });
        } else {
          restoredEdits[i].removeAttribute("contenteditable");
          restoredEdits[i].removeAttribute("spellcheck");
          restoredEdits[i].removeAttribute("data-rcf-try-editing");
        }
      }
      cancel();
    }
    var restoredHovers = document.querySelectorAll("[data-rcf-try-hover]");
    for (var h = 0; h < restoredHovers.length; h += 1)
      restoredHovers[h].removeAttribute("data-rcf-try-hover");
    // Turbo and similar routers can restore a cloned body containing our old
    // chrome. Those clones have no live listeners; remove them before the
    // owned nodes are reattached so the page never carries two preview bars.
    var staleUi = document.querySelectorAll("[data-rcf-try-ui='true']");
    for (var j = 0; j < staleUi.length; j += 1) {
      if (
        staleUi[j] !== style &&
        staleUi[j] !== topbar &&
        staleUi[j] !== toolbarNode &&
        staleUi[j] !== statusNode
      )
        staleUi[j].remove();
    }
    if (!style.isConnected) document.head.appendChild(style);
    if (!topbar.isConnected) document.body.appendChild(topbar);
    if (statusNode && !statusNode.isConnected)
      document.body.appendChild(statusNode);
    return true;
  }

  // Capture at window so host handlers registered on document or elements never
  // observe an activation gesture that belongs to the preview editor.
  listen(window, "mouseover", onMouseOver, true);
  listen(window, "mouseout", onMouseOut, true);
  listen(window, "click", onClick, true);
  listen(window, "change", onChange, true);
  listen(window, "paste", onPaste, true);
  listen(window, "drop", onDrop, true);
  listen(window, "beforeinput", onInput, true);
  listen(window, "input", onInput, true);
  listen(window, "keydown", onKeyDown, true);
  listen(window, "keypress", onActivationKey, true);
  listen(window, "keyup", onKeyUp, true);
  listen(window, "blur", clearLinkHover, true);
  listen(window, "submit", onSubmit, true);
  listen(exitButton, "click", exit);

  window.__rcfTryPreview = { exit: exit, resume: resume };
})();
