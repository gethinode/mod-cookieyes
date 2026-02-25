/*
    Copyright © 2026 The Hinode Team / Mark Dumay. All rights reserved.
    Use of this source code is governed by The MIT License (MIT) that can be found in the LICENSE file.
    Visit gethinode.com/license for more details.

    Storage Access API integration for CookieYes.
    Enables consent persistence when the site is embedded in a cross-site iframe.

    CookieYes sets the consent cookie with SameSite=Strict by default, which the
    browser silently blocks in any cross-site iframe context. The banner then never
    dismisses because CookieYes reads the cookie back to confirm the write succeeded.

    Two-layer fix:

    1. window.ckySettings.iframeSupport = true
       CookieYes's own iframe mode: switches the consent cookie to SameSite=None;Secure,
       which is the minimum required for a cookie to be readable in a cross-site context.
       This resolves the issue for the majority of browsers that allow SameSite=None
       third-party cookies (current Chrome default).

    2. document.requestStorageAccess() on pointerdown
       For browsers that block all third-party cookies regardless of SameSite
       (Firefox Strict, Safari ITP, Chrome with third-party cookies disabled):
       request unpartitioned (first-party) cookie access within the user gesture
       context of the pointerdown event. pointerdown fires before click, so the
       Promise can resolve as a microtask before CookieYes writes the cookie on click.
       If granted, the SameSite=None cookie is written to the unpartitioned jar and
       persists across sessions.

    Requirements on the embedding side:
      - The <iframe> must carry allow="storage-access"
      - When sandboxed, the sandbox attribute must include allow-storage-access-by-user-activation
*/
(function () {
    'use strict';

    var SELECTORS = '.cky-btn-accept-all, .cky-btn-reject-all, .cky-btn-accept, .cky-btn-reject, .cky-btn-save';

    /** Returns true when running inside a cross-site iframe. */
    function isInCrossSiteIframe() {
        try {
            if (window.self === window.top) { return false; }
            var referrerOrigin = document.referrer ? new URL(document.referrer).origin : null;
            return !referrerOrigin || referrerOrigin !== window.location.origin;
        } catch (e) {
            // Cross-origin access to window.top throws; that itself confirms we're embedded.
            return true;
        }
    }

    if (!isInCrossSiteIframe()) { return; }

    // Layer 1: enable CookieYes's built-in iframe mode so the consent cookie is set
    // with SameSite=None;Secure instead of SameSite=Strict. The setting is read by
    // CookieYes's _ckySetCookie function at the moment the user accepts or rejects,
    // so it only needs to be in place before that interaction.
    window.ckySettings = window.ckySettings || {};
    window.ckySettings.iframeSupport = true;

    // Layer 2: request unpartitioned storage access for browsers that block SameSite=None
    // third-party cookies. pointerdown precedes click, giving requestStorageAccess()
    // time to resolve before CookieYes writes the cookie.
    if (typeof document.requestStorageAccess !== 'function') { return; }

    function attachHandler() {
        document.addEventListener('pointerdown', function handler(e) {
            var btn = e.target && typeof e.target.closest === 'function'
                ? e.target.closest(SELECTORS)
                : null;

            if (!btn) { return; }

            document.removeEventListener('pointerdown', handler, true);
            document.requestStorageAccess();
        }, true);
    }

    // Skip setup if storage access is already available.
    if (typeof document.hasStorageAccess === 'function') {
        document.hasStorageAccess().then(function (hasAccess) {
            if (!hasAccess) { attachHandler(); }
        }, attachHandler);
    } else {
        attachHandler();
    }
}());
