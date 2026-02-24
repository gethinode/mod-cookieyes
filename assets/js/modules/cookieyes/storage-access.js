/*
    Copyright © 2026 The Hinode Team / Mark Dumay. All rights reserved.
    Use of this source code is governed by The MIT License (MIT) that can be found in the LICENSE file.
    Visit gethinode.com/license for more details.

    Storage Access API integration for CookieYes.
    Enables consent persistence when the site is embedded in a cross-site iframe.

    When a site is framed by a different origin, browsers treat its cookies as third-party
    and block them by default. The Storage Access API lets the embedded page request
    first-party cookie access after a qualifying user gesture.

    Strategy: listen for pointerdown on CookieYes consent buttons. pointerdown fires
    before click, so requestStorageAccess() can resolve as a microtask before CookieYes
    writes the consent cookie during the subsequent click event. The banner dismisses
    naturally without any click interception. A post-action check reloads once as a
    fallback when the grant races the cookie write (e.g. Safari); storage access is
    then auto-granted on reload and the next consent action persists permanently.

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

    // Only relevant in cross-site iframes with Storage Access API support.
    if (!isInCrossSiteIframe() || typeof document.requestStorageAccess !== 'function') {
        return;
    }

    function attachHandler() {
        // pointerdown fires before click, giving requestStorageAccess() time to resolve
        // as a microtask before CookieYes writes the consent cookie on the click event.
        document.addEventListener('pointerdown', function handler(e) {
            var btn = e.target && typeof e.target.closest === 'function'
                ? e.target.closest(SELECTORS)
                : null;

            if (!btn) { return; }

            document.removeEventListener('pointerdown', handler, true);

            document.requestStorageAccess().then(function () {
                // Storage access granted. Verify the consent cookie was written to the
                // unpartitioned jar. If not (timing race), reload once: the browser will
                // auto-grant storage access on the next load and the repeat consent action
                // will persist.
                setTimeout(function () {
                    if (document.cookie.indexOf('cookieyes-consent') === -1) {
                        window.location.reload();
                    }
                }, 500);
            }, function () {
                // Access denied — cannot persist consent in this context.
            });
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
