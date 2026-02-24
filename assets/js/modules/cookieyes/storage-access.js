/*
    Copyright © 2026 The Hinode Team / Mark Dumay. All rights reserved.
    Use of this source code is governed by The MIT License (MIT) that can be found in the LICENSE file.
    Visit gethinode.com/license for more details.

    Storage Access API integration for CookieYes.
    Enables consent persistence when the site is embedded in a cross-site iframe.

    When a site is framed by a different origin, browsers treat its cookies as third-party
    and block them by default. The Storage Access API lets the embedded page request
    first-party cookie access after a qualifying user gesture. We intercept CookieYes
    consent button clicks (capture phase), obtain storage access, then re-dispatch the
    click so CookieYes can write the consent cookie with access now available.

    Requirements on the embedding side:
      - The <iframe> must carry allow="storage-access"
      - When sandboxed, the sandbox attribute must include allow-storage-access-by-user-activation
*/
(function () {
    'use strict';

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

    function attachInterceptor() {
        var pending = false;

        // Capture-phase listener fires before CookieYes handles the click.
        document.addEventListener('click', function handler(e) {
            if (pending) { return; }

            var target = e.target;
            var btn = target && typeof target.closest === 'function'
                ? target.closest('.cky-btn-accept-all, .cky-btn-reject-all, .cky-btn-accept, .cky-btn-reject, .cky-btn-save')
                : null;

            if (!btn) { return; }

            pending = true;
            e.preventDefault();
            e.stopImmediatePropagation();

            var redispatch = function () {
                pending = false;
                document.removeEventListener('click', handler, true);
                // Re-dispatch so CookieYes processes the click with storage access now granted.
                btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            };

            document.requestStorageAccess().then(redispatch, redispatch);
        }, true);
    }

    // Skip setup if storage access is already available.
    if (typeof document.hasStorageAccess === 'function') {
        document.hasStorageAccess().then(function (hasAccess) {
            if (!hasAccess) { attachInterceptor(); }
        }, attachInterceptor);
    } else {
        attachInterceptor();
    }
}());
