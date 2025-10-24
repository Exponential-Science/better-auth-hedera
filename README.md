# Hedera Better Auth

Hedera blockchain integration plugin for [better-auth](https://github.com/better-auth/better-auth) - enabling Sign-In With Hedera (SIWH) authentication.

## Features

- 🔐 **Sign-In With Hedera (SIWH)** - Authenticate users with their Hedera wallet
- 🌐 **Multi-Network Support** - Works with Mainnet, Testnet, and Previewnet
- ✅ **CAIP-122 Compliant** - Follows Chain Agnostic Improvement Proposal standards
- 🔗 **Wallet Linking** - Link multiple Hedera addresses to a single user account
- 📧 **Email Integration** - Optional email generation from wallet addresses
- 🤝 **Compatible with better-auth SIWE** - Works alongside [Sign-In With Ethereum](https://www.better-auth.com/docs/plugins/siwe) plugin
- 🎯 **TypeScript First** - Full type safety and IntelliSense support
- ⚡ **Built with Bun** - Fast, modern build tooling

## Installation

```bash
npm install @exponentialscience/better-auth-hedera
# or
yarn add @exponentialscience/better-auth-hedera
# or
pnpm add @exponentialscience/better-auth-hedera
# or
bun add @exponentialscience/better-auth-hedera
```

## Setup

### Server Setup

```typescript
import { betterAuth } from "better-auth";
import { siwh } from "@exponentialscience/better-auth-hedera/server";

export const auth = betterAuth({
  // ... your better-auth config
  plugins: [
    siwh({
      domain: "yourdomain.com",
      emailDomainName: "yourdomain.com", // Optional: for generating emails
      autoSignUp: true, // Optional: auto-create accounts
      anonymous: false, // Optional: allow anonymous sign-in

      // Generate a nonce for the sign-in message
      getNonce: async () => {
        return crypto.randomUUID();
      },

      // Verify the signed message from the wallet
      verifyMessage: async ({
        message,
        signature,
        address,
        chainId,
        cacao,
      }) => {
        // Implement your verification logic here
        // This should verify the signature against the message
        // using Hedera's cryptographic verification
        return true; // or false if verification fails
      },
    }),
  ],
});
```

### Client Setup

```typescript
import { createAuthClient } from "better-auth/client";
import { siwhClient } from "@exponentialscience/better-auth-hedera/client";

export const authClient = createAuthClient({
  plugins: [siwhClient()],
});
```

## Usage

### Generate a Nonce

Before signing a SIWH message, you need to generate a nonce for the wallet address:

```typescript
const { data, error } = await authClient.siwh.getNonce({
  walletAddress: "0.0.9167913",
  chainId: "hedera:mainnet",
});

if (data) {
  console.log("Nonce:", data.nonce);
}
```

### Sign In with Hedera

After generating a nonce and creating a SIWH message, verify the signature to authenticate:

```typescript
import { signatureToBase64 } from "@exponentialscience/better-auth-hedera";

// Get signature from wallet (e.g., HashConnect)
const signatureUint8Array = await hashconnect.signMessages(accountId, message);

// Convert Uint8Array to base64 string for transmission
const signatureBase64 = signatureToBase64(signatureUint8Array);

const { data, error } = await authClient.siwh.verify({
  message: "Your SIWH message string",
  walletAddress: "0.0.9167913",
  chainId: "hedera:mainnet",
  signature: signatureBase64, // base64 encoded signature string
  email: "user@example.com", // optional, required if anonymous is false
  callbackURL: "/dashboard", // optional, redirect URL after sign-in
  data: {
    name: "Full Name",
    password: "User's password",
  }, // optional, additional user data
});

if (data) {
  console.log("Authentication successful:", data.user);
}
```

### Complete Example with HashConnect

Here's a complete example showing the full authentication flow with HashConnect:

```typescript
import { signatureToBase64 } from "@exponentialscience/better-auth-hedera";
import { HashConnect } from "hashconnect";

async function signInWithHedera() {
  const hashconnect = new HashConnect();
  const accountId = "0.0.9167913";
  const chainId = "hedera:testnet";

  // Step 1: Get nonce from server
  const { data: nonceData } = await authClient.siwh.getNonce({
    walletAddress: accountId,
    chainId: chainId,
  });

  if (!nonceData) {
    console.error("Failed to get nonce");
    return;
  }

  // Step 2: Create SIWH message
  const message = `Sign in to MyApp\n\nNonce: ${nonceData.nonce}`;

  // Step 3: Sign message with wallet
  const signatureUint8Array = await hashconnect.signMessages(
    accountId,
    message
  );

  // Step 4: Convert signature to base64
  const signatureBase64 = signatureToBase64(signatureUint8Array);

  // Step 5: Verify signature and authenticate
  const { data, error } = await authClient.siwh.verify({
    message,
    walletAddress: accountId,
    chainId: chainId,
    signature: signatureBase64,
  });

  if (data) {
    console.log("Successfully signed in:", data.user);
  } else {
    console.error("Sign in failed:", error);
  }
}
```

## Configuration Options

### Server Options

The SIWH plugin accepts the following configuration options:

- **domain**: The domain name of your application (required for SIWH message generation)
- **emailDomainName**: The email domain name for creating user accounts when not using anonymous mode. Defaults to the domain from your base URL
- **anonymous**: Whether to allow anonymous sign-ins without requiring an email. Default is true
- **autoSignUp**: Whether to automatically create a new account if one doesn't exist. Default is false
- **getNonce**: Function to generate a unique nonce for each sign-in attempt. You must implement this function to return a cryptographically secure random string. Must return a `Promise<string>`
- **verifyMessage**: Function to verify the signed SIWE message. Receives message details and should return `Promise<boolean>`
- **schema**: Optional database schema extension for additional user fields

### Client Options

The SIWH client plugin doesn't require any configuration options, but you can pass them if needed for future extensibility:

```typescript
import { createAuthClient } from "better-auth/client";
import { siwhClient } from "@exponentialscience/better-auth-hedera/client";

export const authClient = createAuthClient({
  plugins: [
    siwhClient({
      // Optional client configuration can go here
    }),
  ],
});
```

## Utility Functions

### Signature Conversion

The library provides utility functions to convert between `Uint8Array` and base64 string formats for signatures:

#### `signatureToBase64(signature: Uint8Array): string`

Converts a `Uint8Array` signature (from HashConnect or other wallets) to a base64 string for HTTP transmission.

```typescript
import { signatureToBase64 } from "@exponentialscience/better-auth-hedera";

const signature = await hashconnect.signMessages(accountId, message);
const signatureString = signatureToBase64(signature);
```

#### `base64ToSignature(signature: string): Uint8Array`

Converts a base64 string signature back to `Uint8Array`. This is used internally by the server but can be useful for verification purposes.

```typescript
import { base64ToSignature } from "@exponentialscience/better-auth-hedera";

const signatureUint8Array = base64ToSignature(signatureBase64);
```

**Note:** The server automatically handles the conversion from base64 to `Uint8Array`, so you only need to use `signatureToBase64()` on the client side.

## Schema

The SIWH plugin adds a `walletAddress` table to store user wallet associations (compatible with better-auth SIWE):

| Field     | Type    | Description                               |
| --------- | ------- | ----------------------------------------- |
| id        | string  | Primary key                               |
| userId    | string  | Reference to user.id                      |
| address   | string  | Hedera wallet address                     |
| chainId   | string  | CAIP-2 chain ID (e.g., "hedera:mainnet")  |
| isPrimary | boolean | Whether this is the user's primary wallet |
| createdAt | date    | Creation timestamp                        |

## Supported Networks

The plugin supports all Hedera networks:

```typescript
import { HederaChainId } from "@exponentialscience/better-auth-hedera";

// Available chain IDs:
HederaChainId.Mainnet; // "hedera:mainnet"
HederaChainId.Testnet; // "hedera:testnet"
HederaChainId.Previewnet; // "hedera:previewnet"
```

## Development

```bash
# Install dependencies
bun install

# Build the package
bun run build

# The build process uses Bun's native bundler - no external tools needed!
```

## License

MIT © [Exponential Science](https://www.exp.science/)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Links

- [better-auth](https://github.com/better-auth/better-auth) - The authentication framework this plugin extends
- [Hedera](https://hedera.com/) - The Hedera network
- [CAIP-122](https://github.com/ChainAgnostic/CAIPs/blob/master/CAIPs/caip-122.md) - Sign-in With X specification
