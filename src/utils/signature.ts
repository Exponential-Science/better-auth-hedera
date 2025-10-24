/**
 * Converts a Uint8Array signature to a base64 string
 * This is useful when working with hashconnect's signMessages function
 * which returns a Uint8Array
 *
 * @param signature - The signature as Uint8Array from hashconnect
 * @returns Base64 encoded string
 *
 * @example
 * ```typescript
 * import { signatureToBase64 } from "@exponentialscience/better-auth-hedera/utils";
 *
 * const signature = await hashconnect.signMessages(accountId, message);
 * const signatureString = signatureToBase64(signature);
 *
 * await authClient.siwh.verify({
 *   message,
 *   signature: signatureString,
 *   walletAddress,
 *   chainId
 * });
 * ```
 */
export function signatureToBase64(signature: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    // Node.js environment
    return Buffer.from(signature).toString("base64");
  } else {
    // Browser environment
    const binary = String.fromCharCode(...signature);
    return btoa(binary);
  }
}

/**
 * Converts a base64 string signature back to Uint8Array
 * This is useful for verification purposes
 *
 * @param signature - The base64 encoded signature string
 * @returns Uint8Array
 */
export function base64ToSignature(signature: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    // Node.js environment
    return new Uint8Array(Buffer.from(signature, "base64"));
  } else {
    // Browser environment
    const binary = atob(signature);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}
