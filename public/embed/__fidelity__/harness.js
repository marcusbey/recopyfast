/**
 * Edit-mode fidelity measurement harness.
 *
 * Loaded only by public/embed/__fidelity__/index.html. It drives every scenario
 * through its full edit lifecycle and reports, per scenario, the numeric delta
 * between how the text renders in READ mode and how it renders in EDIT mode.
 *
 * The measurement deliberately resolves "the node that is actually painting the
 * text" rather than the original element: an overlay renderer hides the original
 * and paints a substitute, and the whole point of the exercise is to catch that
 * substitute drifting. See resolveRenderNode().
 *
 * Everything here is independent of the widget's own style logic on purpose —
 * a harness that reuses the code under test cannot falsify it.
 *
 *   await window.__rcfFidelity.run()        // all scenarios
 *   await window.__rcfFidelity.run(['plain','uppercase'])
 *   window.__rcfFidelity.enter('uppercase') // leave one open for a screenshot
 *   window.__rcfFidelity.exit()
 */
(function () {
  'use strict';

  /**
   * The fixture has no real site row behind it, so every save round-trip ends in
   * an alert() that blocks the page and makes screenshots impossible. Record the
   * dialogs instead of showing them — they are an artefact of the fixture, not a
   * result. Anything unexpected still shows up in __rcfFidelity.dialogs.
   */
  var DIALOGS = [];
  window.alert = function (msg) { DIALOGS.push({ kind: 'alert', msg: String(msg) }); };
  window.confirm = function (msg) { DIALOGS.push({ kind: 'confirm', msg: String(msg) }); return true; };

  var SCENARIOS = [
    { key: 'plain',        id: 'fx-plain' },
    { key: 'uppercase',    id: 'fx-uppercase' },
    { key: 'centred',      id: 'fx-center' },
    { key: 'over-photo',   id: 'fx-photo' },
    { key: 'over-gradient',id: 'fx-gradient' },
    { key: 'ancestor-bg',  id: 'fx-ancestor' },
    { key: 'alpha-bg',     id: 'fx-alpha' },
    { key: 'clip-text',    id: 'fx-cliptext' },
    { key: 'blend-mode',   id: 'fx-blend' },
    { key: 'scaled',       id: 'fx-scaled' },
    { key: 'rotated',      id: 'fx-rotated' },
    { key: 'rtl',          id: 'fx-rtl' },
    { key: 'vertical',     id: 'fx-vertical' },
    { key: 'pre',          id: 'fx-pre' },
    { key: 'ellipsis',     id: 'fx-ellipsis' },
    { key: 'line-clamp',   id: 'fx-clamp' },
    { key: 'web-font',     id: 'fx-webfont' },
    { key: 'inline-span',  id: 'fx-inline' },
    { key: 'nested',       id: 'fx-nested' },
    { key: 'important',    id: 'fx-important' },
    { key: 'sticky',       id: 'fx-sticky' },
    { key: 'in-scroller',  id: 'fx-scrolled' },
    { key: 'animated',     id: 'fx-animated' },
    { key: 'light-card',   id: 'fx-lightcard' },
    { key: 'dark-panel',   id: 'fx-dark' },
    { key: 'low-contrast', id: 'fx-lowcontrast' },
    { key: 'filtered',     id: 'fx-filtered' },
    { key: 'faded',        id: 'fx-faded' },
    { key: 'link',         id: 'fx-link' },
    { key: 'button',       id: 'fx-button' },
    { key: 'zoomed',       id: 'fx-zoomed' },
    { key: 'small-text',   id: 'fx-small' },
    { key: 'variable-font',id: 'fx-variable' },
    { key: 'over-video',   id: 'fx-video' },
    { key: 'late-swap',    id: 'fx-lateswap' }
  ];

  /** Typography properties whose value must be identical read vs. edit. */
  var TYPO = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
    'letterSpacing', 'wordSpacing', 'textAlign', 'textTransform',
    'textDecorationLine', 'textIndent', 'whiteSpace', 'direction',
    'writingMode', 'fontVariationSettings', 'fontFeatureSettings',
    'textShadow', 'color'
  ];

  function round(n) { return Math.round(n * 100) / 100; }

  /**
   * Which node is painting this scenario's text right now?
   * An overlay renderer hides the original element and paints a replacement, so
   * comparing the original against itself would report a perfect score for a
   * renderer that is visibly wrong.
   */
  function resolveRenderNode(el) {
    var hidden = window.getComputedStyle(el).visibility === 'hidden';
    if (!hidden) return { node: el, substituted: false };

    var overlays = document.querySelectorAll('.rcf-edit-overlay');
    for (var i = 0; i < overlays.length; i++) {
      var input = overlays[i].querySelector('.rcf-edit-input');
      return { node: input || overlays[i], substituted: true };
    }
    return { node: el, substituted: true };
  }

  /** Bounding box of the rendered glyphs, not of the element box. */
  function glyphRect(node) {
    try {
      if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') return null;
      var range = document.createRange();
      range.selectNodeContents(node);
      var r = range.getBoundingClientRect();
      range.detach && range.detach();
      if (!r || (r.width === 0 && r.height === 0)) return null;
      return { x: round(r.left), y: round(r.top), w: round(r.width), h: round(r.height) };
    } catch (e) {
      return null;
    }
  }

  function parseRgb(str) {
    if (!str) return null;
    var m = str.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?/i);
    if (!m) return null;
    return {
      r: parseFloat(m[1]), g: parseFloat(m[2]), b: parseFloat(m[3]),
      a: m[4] === undefined ? 1 : parseFloat(m[4])
    };
  }

  function luminance(c) {
    var ch = [c.r, c.g, c.b].map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }

  function contrast(fg, bg) {
    var l1 = luminance(fg), l2 = luminance(bg);
    var hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return round((hi + 0.05) / (lo + 0.05));
  }

  /**
   * Independent reimplementation of "what is actually behind this text".
   * Walks to the root compositing alpha, and reports when the backdrop is
   * something a CSS colour cannot describe (image / gradient / video), because
   * that is precisely the case a contrast number cannot be trusted for.
   */
  /**
   * A full-coverage inset box-shadow is how the widget paints a readability
   * scrim: it sits above the element's own background and below its text
   * without touching any layout property. It is genuinely part of what is
   * behind the glyphs, so contrast has to be measured through it.
   */
  function insetScrim(node) {
    var shadow = window.getComputedStyle(node).boxShadow;
    if (!shadow || shadow === 'none' || shadow.indexOf('inset') === -1) return null;

    var m = shadow.match(/(rgba?\([^)]*\))\s+0px\s+0px\s+0px\s+(\d+)px\s+inset/);
    if (!m || parseInt(m[2], 10) < 500) return null;
    return parseRgb(m[1]);
  }

  function backdrop(node) {
    var el = node;
    var stack = [];
    var kind = 'solid';

    var scrim = insetScrim(node);
    if (scrim) stack.push(scrim);

    while (el && el.nodeType === 1) {
      var cs = window.getComputedStyle(el);
      var bgImage = cs.backgroundImage;

      if (bgImage && bgImage !== 'none') {
        kind = /gradient/i.test(bgImage) ? 'gradient' : 'image';
        break;
      }
      if (el.querySelector && el.querySelector(':scope > video')) {
        kind = 'video';
        break;
      }
      var c = parseRgb(cs.backgroundColor);
      if (c && c.a > 0) {
        stack.push(c);
        if (c.a >= 1) break;
      }
      el = el.parentElement;
    }

    if (kind !== 'solid') return { kind: kind, color: null };
    if (!stack.length) return { kind: 'solid', color: { r: 255, g: 255, b: 255, a: 1 } };

    // Composite from the furthest ancestor forward.
    var out = { r: 255, g: 255, b: 255, a: 1 };
    for (var i = stack.length - 1; i >= 0; i--) {
      var s = stack[i];
      out = {
        r: s.r * s.a + out.r * (1 - s.a),
        g: s.g * s.a + out.g * (1 - s.a),
        b: s.b * s.a + out.b * (1 - s.a),
        a: 1
      };
    }
    return { kind: 'solid', color: out };
  }

  function snapshot(el) {
    var resolved = resolveRenderNode(el);
    var node = resolved.node;
    var cs = window.getComputedStyle(node);
    var r = node.getBoundingClientRect();

    var typo = {};
    TYPO.forEach(function (p) { typo[p] = cs[p]; });

    var bg = backdrop(node);
    var fg = parseRgb(cs.color);
    var ratio = (bg.kind === 'solid' && fg && fg.a > 0.5) ? contrast(fg, bg.color) : null;

    /**
     * For backdrops CSS cannot describe (photo, gradient, video) the single
     * number above is a guess. What the widget actually promises is a floor, so
     * measure the floor: composite whatever scrim is present over the two
     * extreme backdrops and take the worse result. That is the number the text
     * is guaranteed to beat no matter what pixels are underneath.
     */
    /**
     * WCAG 2.1 AA threshold for THIS element: 3:1 for large text (>=24px, or
     * >=18.66px bold), 4.5:1 otherwise. Applying 4.5 everywhere would report
     * false failures on display type.
     */
    var fontSizePx = parseFloat(cs.fontSize) || 16;
    var fontWeightNum = parseInt(cs.fontWeight, 10) || 400;
    var required = (fontSizePx >= 24 || (fontWeightNum >= 700 && fontSizePx >= 18.66)) ? 3 : 4.5;

    var guaranteed = null;
    if (fg && fg.a > 0.5) {
      var scrim = insetScrim(node);
      var worst = Infinity;
      [{ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 }].forEach(function (extreme) {
        var painted = extreme;
        if (scrim) {
          painted = {
            r: scrim.r * scrim.a + extreme.r * (1 - scrim.a),
            g: scrim.g * scrim.a + extreme.g * (1 - scrim.a),
            b: scrim.b * scrim.a + extreme.b * (1 - scrim.a),
            a: 1
          };
        }
        worst = Math.min(worst, contrast(fg, painted));
      });
      guaranteed = round(worst);
    }

    return {
      renderTag: node.tagName.toLowerCase(),
      substituted: resolved.substituted,
      box: { x: round(r.left), y: round(r.top), w: round(r.width), h: round(r.height) },
      glyph: glyphRect(node),
      typo: typo,
      bgKind: bg.kind,
      contrast: ratio,
      guaranteed: guaranteed,
      hasScrim: !!insetScrim(node),
      required: required,
      fontSizePx: fontSizePx,
      /**
       * THE INVARIANT.
       *
       * effective = the ratio the user actually gets. For a backdrop CSS can
       * describe, that is the measured ratio through any scrim. For a photo /
       * gradient / video it is the guaranteed worst case, because a measured
       * number there would be a guess.
       *
       * null means "not applicable, and here is why" rather than a silent pass:
       * transparent text (background-clip: text) has no contrast to measure.
       */
      effective: (fg && fg.a > 0.5)
        ? (bg.kind === 'solid' ? ratio : guaranteed)
        : null,
      notApplicable: (fg && fg.a > 0.5) ? null : 'text is not painted (transparent / background-clip: text)',
      text: node.value !== undefined ? node.value : (node.textContent || '')
    };
  }

  function diff(before, during) {
    var out = {
      renderer: during.substituted ? 'substituted (' + during.renderTag + ')' : 'in-place',
      dx: round(during.box.x - before.box.x),
      dy: round(during.box.y - before.box.y),
      dw: round(during.box.w - before.box.w),
      dh: round(during.box.h - before.box.h),
      gdx: null, gdy: null, gdw: null, gdh: null,
      typoDrift: [],
      contrastBefore: before.contrast,
      contrastDuring: during.contrast,
      guaranteedBefore: before.guaranteed,
      guaranteedDuring: during.guaranteed,
      scrimApplied: during.hasScrim,
      bgKind: before.bgKind,
      required: during.required,
      effectiveRead: before.effective,
      effectiveEdit: during.effective,
      notApplicable: during.notApplicable,
      // Edit mode must reach the threshold...
      // 0.01 slack: the reported ratios are rounded to 2dp, so a solve that lands
      // exactly on the threshold can read as 4.49 purely from rounding.
      invariantHolds: during.effective === null ? null : during.effective >= during.required - 0.01,
      // ...and must never make things worse than read mode (1e-6 for float noise).
      contrastRegressed: (before.effective === null || during.effective === null)
        ? null
        : during.effective < before.effective - 1e-6,
      textBefore: (before.text || '').trim().slice(0, 60),
      textDuring: (during.text || '').trim().slice(0, 60)
    };

    if (before.glyph && during.glyph) {
      out.gdx = round(during.glyph.x - before.glyph.x);
      out.gdy = round(during.glyph.y - before.glyph.y);
      out.gdw = round(during.glyph.w - before.glyph.w);
      out.gdh = round(during.glyph.h - before.glyph.h);
    }

    TYPO.forEach(function (p) {
      if (before.typo[p] !== during.typo[p]) {
        out.typoDrift.push(p + ': "' + before.typo[p] + '" -> "' + during.typo[p] + '"');
      }
    });

    out.textCorrupted = out.textBefore !== out.textDuring;
    // Worst single positional error in CSS px.
    out.maxShift = Math.max(
      Math.abs(out.dx), Math.abs(out.dy), Math.abs(out.dw), Math.abs(out.dh),
      Math.abs(out.gdx || 0), Math.abs(out.gdy || 0), Math.abs(out.gdw || 0), Math.abs(out.gdh || 0)
    );
    return out;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function fire(node, type, init) {
    node.dispatchEvent(Object.assign(
      new (type.indexOf('key') === 0 ? KeyboardEvent : MouseEvent)(type, { bubbles: true, cancelable: true }),
      init || {}
    ));
  }

  function clickToEdit(el) {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }

  function escapeEdit() {
    var target = document.activeElement || document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true
    }));
    // Modal-based editors (image) listen on document.
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true
    }));
  }

  /** Scroll the target into a stable position so measurements are comparable. */
  function park(el) {
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  }

  async function measureOne(scenario) {
    var el = document.getElementById(scenario.id);
    if (!el) return { key: scenario.key, error: 'element #' + scenario.id + ' not found' };
    if (!el.hasAttribute('data-rcf-id')) {
      return { key: scenario.key, error: 'not registered as editable by the widget' };
    }

    park(el);
    await sleep(90);

    var before = snapshot(el);
    clickToEdit(el);
    await sleep(220);
    var during = snapshot(el);

    escapeEdit();
    await sleep(180);

    var after = snapshot(el);
    var d = diff(before, during);
    d.key = scenario.key;
    // Tolerance, not equality: an element with a running keyframe animation is
    // in a different position on every frame, so exact equality would report a
    // false violation for a renderer that behaved perfectly.
    d.restored = Math.abs(after.box.x - before.box.x) <= 1 &&
                 Math.abs(after.box.y - before.box.y) <= 1 &&
                 (after.text || '').trim() === (before.text || '').trim();
    return d;
  }

  async function run(only) {
    var list = only && only.length
      ? SCENARIOS.filter(function (s) { return only.indexOf(s.key) !== -1; })
      : SCENARIOS;

    var results = [];
    for (var i = 0; i < list.length; i++) {
      results.push(await measureOne(list[i]));
    }
    return results;
  }

  function table(results) {
    var head = 'scenario        shift  renderer   typo    text   READ    EDIT   need  invariant\n' +
               '--------------------------------------------------------------------------------\n';
    return head + results.map(function (r) {
      if (r.error) return r.key.padEnd(15) + ' ERROR: ' + r.error;
      var verdict = r.invariantHolds === null ? 'n/a'
        : (r.invariantHolds ? 'PASS' : 'FAIL');
      if (r.contrastRegressed) verdict += ' REGRESSED';
      return [
        r.key.padEnd(15),
        String(r.maxShift).padStart(6),
        (r.renderer === 'in-place' ? 'in-place' : 'SUBST').padEnd(9),
        r.typoDrift.length ? ('DRIFT' + r.typoDrift.length) : 'ok   ',
        r.textCorrupted ? 'BAD ' : 'ok  ',
        (r.effectiveRead === null ? '  -  ' : String(r.effectiveRead)).padStart(6),
        (r.effectiveEdit === null ? '  -  ' : String(r.effectiveEdit)).padStart(6),
        String(r.required).padStart(5),
        verdict
      ].join(' ');
    }).join('\n');
  }

  /**
   * Hard pass/fail gate. Returns a summary plus every violation, so a
   * regression fails loudly instead of looking "mostly fine" in a screenshot.
   *
   * Three things are asserted per scenario:
   *   1. zero geometry shift between read and edit mode
   *   2. zero typography drift and no text corruption
   *   3. the contrast invariant: edit-mode contrast >= the element's WCAG AA
   *      threshold, and never below what read mode already achieved
   */
  function assert(results, shiftTolerancePx) {
    var tol = shiftTolerancePx === undefined ? 0.5 : shiftTolerancePx;
    var violations = [];

    results.forEach(function (r) {
      if (r.error) { violations.push(r.key + ': ' + r.error); return; }

      if (r.maxShift > tol) {
        violations.push(r.key + ': geometry shifted ' + r.maxShift + 'px (tolerance ' + tol + ')');
      }
      if (r.typoDrift.length) {
        violations.push(r.key + ': typography drift — ' + r.typoDrift.join('; '));
      }
      if (r.textCorrupted) {
        violations.push(r.key + ': text changed "' + r.textBefore + '" -> "' + r.textDuring + '"');
      }
      if (r.renderer !== 'in-place') {
        violations.push(r.key + ': rendered by a substitute node (' + r.renderer + ')');
      }
      if (r.invariantHolds === false && r.effectiveEdit < r.required - 0.01) {
        violations.push(r.key + ': CONTRAST ' + r.effectiveEdit + ':1 in edit mode, needs ' + r.required + ':1');
      }
      if (r.contrastRegressed) {
        violations.push(r.key + ': CONTRAST REGRESSED ' + r.effectiveRead + ' -> ' + r.effectiveEdit);
      }
      if (!r.restored) {
        violations.push(r.key + ': element not restored after cancel');
      }
    });

    return {
      scenarios: results.length,
      violations: violations,
      passed: violations.length === 0,
      notApplicable: results.filter(function (r) { return r.notApplicable; })
        .map(function (r) { return r.key + ': ' + r.notApplicable; })
    };
  }

  window.__rcfFidelity = {
    scenarios: SCENARIOS,
    run: run,
    table: table,
    assert: assert,
    snapshot: function (key) {
      var s = SCENARIOS.filter(function (x) { return x.key === key; })[0];
      return s ? snapshot(document.getElementById(s.id)) : null;
    },
    enter: function (key) {
      var s = SCENARIOS.filter(function (x) { return x.key === key; })[0];
      if (!s) return 'unknown scenario';
      var el = document.getElementById(s.id);
      park(el);
      clickToEdit(el);
      return 'entered ' + key;
    },
    exit: escapeEdit,
    dialogs: DIALOGS,
    ready: function () {
      return document.querySelectorAll('[data-rcf-id]').length;
    }
  };
})();
