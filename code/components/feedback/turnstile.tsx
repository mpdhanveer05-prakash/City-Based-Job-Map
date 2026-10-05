"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render(element: HTMLElement, options: { sitekey: string; action: string; callback(token: string): void; "expired-callback"(): void; "error-callback"(): void }): string;
      remove(widgetId: string): void;
      reset(widgetId: string): void;
    };
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<void> | null = null;

/** Loads Cloudflare's script once for the page. Resolves when `window.turnstile` exists. */
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error("The check could not be loaded."));
    };
    document.head.append(script);
  });
  return loading;
}

/**
 * The Cloudflare Turnstile check (docs/security.md, "Public forms"): a managed challenge that is usually invisible. It gives
 * the form a one-use token, which the Edge Function verifies before storing anything. `onToken(null)` means the token is
 * gone (it expired, or the check failed) and the form must not be sent.
 */
export function Turnstile({ siteKey, onToken, resetKey }: { siteKey: string; onToken(token: string | null): void; resetKey: number }) {
  const box = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  useEffect(() => {
    callback.current = onToken;
  });

  useEffect(() => {
    let widget: string | undefined;
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile) return;
        widget = window.turnstile.render(box.current, {
          sitekey: siteKey,
          action: "feedback",
          callback: (token) => callback.current(token),
          "expired-callback": () => callback.current(null),
          "error-callback": () => callback.current(null),
        });
      })
      .catch(() => callback.current(null));
    return () => {
      cancelled = true;
      if (widget && window.turnstile) window.turnstile.remove(widget);
    };
    // A new resetKey asks for a fresh check (after a send, the old token is used up).
  }, [siteKey, resetKey]);

  return <div ref={box} data-testid="turnstile" />;
}
