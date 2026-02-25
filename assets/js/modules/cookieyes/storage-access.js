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

    2. Click interception + requestStorageAccess() + performBannerAction()
       For browsers that block all third-party cookies regardless of SameSite
       (Firefox Strict, Safari ITP including all iOS browsers, Chrome with third-party
       cookies disabled):
       - Intercept the click on CookieYes buttons (capture phase, before CookieYes).
       - stopImmediatePropagation() prevents CookieYes from processing the isTrusted
         click event (CookieYes checks event.isTrusted and rejects synthetic events).
       - requestStorageAccess() is awaited via .then() so the grant is in effect before
         the cookie is written.
       - window.performBannerAction() is CookieYes's own public API and calls the
         internal consent handler with {isTrusted: true}, bypassing the isTrusted check.
       This handler is only attached when hasStorageAccess() returns false, so desktop
       Chrome users (who don't need it) are unaffected.

    Requirements on the embedding side:
      - The <iframe> must carry allow="storage-access"
      - When sandboxed, the sandbox attribute must include allow-storage-access-by-user-activation
*/
(function () {
    'use strict';

    /** Maps CookieYes button classes to performBannerAction() argument values. */
    var ACTION_MAP = {
        'cky-btn-accept-all': 'accept_all',
        'cky-btn-accept':     'accept_partial',
        'cky-btn-save':       'accept_partial',
        'cky-btn-reject-all': 'reject',
        'cky-btn-reject':     'reject'
    };

    var SELECTORS = Object.keys(ACTION_MAP).map(function (c) { return '.' + c; }).join(', ');

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

    // Layer 2: for browsers that block all third-party cookies regardless of SameSite
    // (Firefox Strict, Safari ITP, all iOS browsers, Chrome with third-party cookies
    // disabled), intercept CookieYes button clicks and use the Storage Access API to
    // gain unpartitioned cookie access before invoking the consent action.
    if (typeof document.requestStorageAccess !== 'function') { return; }

    /** Returns the performBannerAction argument for the given button, or null. */
    function getAction(btn) {
        for (var cls in ACTION_MAP) {
            if (btn.classList.contains(cls)) { return ACTION_MAP[cls]; }
        }
        return null;
    }

    function attachHandler() {
        document.addEventListener('click', function handler(e) {
            var btn = e.target && typeof e.target.closest === 'function'
                ? e.target.closest(SELECTORS)
                : null;

            if (!btn) { return; }

            var action = getAction(btn);
            if (!action) { return; }

            // Remove our handler and prevent CookieYes from receiving this click.
            // CookieYes checks event.isTrusted and ignores synthetic re-dispatches,
            // so we use performBannerAction() after the storage access grant instead.
            document.removeEventListener('click', handler, true);
            e.preventDefault();
            e.stopImmediatePropagation();

            function invoke() {
                if (typeof window.performBannerAction === 'function') {
                    window.performBannerAction(action);
                }
            }

            // Request unpartitioned storage access within the user gesture context of
            // the click event, then invoke the consent action. On denial (e.g. user
            // dismissed Safari's permission sheet), invoke anyway so the banner closes;
            // the cookie will not persist but the UX is not broken.
            document.requestStorageAccess().then(invoke, invoke);
        }, true);
    }

    // Only attach the handler when storage access is not already available.
    // On desktop Chrome (SameSite=None allowed), hasStorageAccess() returns true
    // and Layer 1 alone is sufficient — no click interception needed.
    if (typeof document.hasStorageAccess === 'function') {
        document.hasStorageAccess().then(function (hasAccess) {
            if (!hasAccess) { attachHandler(); }
        }, attachHandler);
    } else {
        attachHandler();
    }
}());
