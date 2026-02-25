/*
    Copyright © 2026 The Hinode Team / Mark Dumay. All rights reserved.
    Use of this source code is governed by The MIT License (MIT) that can be found in the LICENSE file.
    Visit gethinode.com/license for more details.

    Consent banner integration for CookieYes when embedded in a cross-site iframe.

    CookieYes sets the consent cookie with SameSite=Strict by default, which the
    browser silently blocks in any cross-site iframe context. The banner then never
    dismisses because CookieYes reads the cookie back to confirm the write succeeded.

    Two-layer fix:

    1. window.ckySettings.iframeSupport = true
       CookieYes's own iframe mode: switches the consent cookie to SameSite=None;Secure,
       which is the minimum required for a cookie to be readable in a cross-site context.
       This resolves the issue for the majority of browsers that allow SameSite=None
       third-party cookies (current Chrome default).

    2. Banner suppression via CSS + cookieyes_banner_load event
       The Storage Access API cannot prevent the banner from reappearing on iOS: grants
       are document-scoped (expire on reload), and CookieYes reads cookies at page-load
       time before any user gesture can trigger requestStorageAccess().

       Instead, the banner is suppressed entirely in preview/showcase iframes:
       - A CSS rule is injected synchronously to hide the banner elements before they
         render (cookieyes_banner_load fires after the banner is already in the DOM,
         so CSS is required to prevent the visual flash).
       - On cookieyes_banner_load, performBannerAction('accept_all') is called to update
         CookieYes's in-memory consent state and unblock consent-gated scripts.

       On desktop Chrome (where SameSite=None cookies work), Layer 1 ensures the cookie
       is written on first acceptance; subsequent loads find the cookie and do not show
       the banner, so Layer 2 becomes a no-op after the first visit.
       On iOS (Safari ITP, all iOS browsers) the cookie write fails, so suppression
       re-runs on every load — but invisibly to the user.
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

    if (!isInCrossSiteIframe()) { return; }

    // Layer 1: enable CookieYes's built-in iframe mode so the consent cookie is set
    // with SameSite=None;Secure instead of SameSite=Strict. The setting is read by
    // CookieYes's _ckySetCookie function at the moment the user accepts or rejects,
    // so it only needs to be in place before that interaction.
    window.ckySettings = window.ckySettings || {};
    window.ckySettings.iframeSupport = true;

    // Layer 2: suppress the consent banner in cross-site preview/showcase iframes.
    // The Storage Access API cannot prevent the banner from reappearing on iOS:
    // grants are document-scoped (expire on reload), and CookieYes reads cookies
    // at page-load time before any user gesture can trigger requestStorageAccess().
    //
    // Instead, hide the banner visually via CSS (prevents flash, since
    // cookieyes_banner_load fires after the banner is already in the DOM),
    // then call performBannerAction() once CookieYes has initialised to update
    // its in-memory consent state and unblock consent-gated scripts.
    //
    // On desktop Chrome (where SameSite=None cookies work), iframeSupport=true
    // ensures the consent cookie is written on first acceptance; subsequent loads
    // find the cookie and do not show the banner, so this code becomes a no-op.

    var style = document.createElement('style');
    style.textContent = '.cky-consent-bar,.cky-overlay,.cky-preference-center{display:none!important}';
    (document.head || document.documentElement).appendChild(style);

    window.addEventListener('cookieyes_banner_load', function onBannerLoad() {
        window.removeEventListener('cookieyes_banner_load', onBannerLoad);
        if (typeof window.performBannerAction === 'function') {
            window.performBannerAction('accept_all');
        }
    });
}());
