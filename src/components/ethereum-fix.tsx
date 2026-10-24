"use client";

import { useEffect } from "react";

export function EthereumFix() {
  useEffect(() => {
    const browserWindow = window as Window & { ethereum?: unknown };

    if (browserWindow.ethereum) {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(window, "ethereum");
        if (descriptor && !descriptor.configurable) {
          Object.defineProperty(window, "ethereum", {
            value: browserWindow.ethereum,
            configurable: true,
            writable: true,
            enumerable: descriptor.enumerable,
          });
        }
      } catch {
        // ignore
      }
    }
  }, []);

  return null;
}
