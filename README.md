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
npm install @esf/better-auth-hedera
# or
yarn add @esf/better-auth-hedera
# or
pnpm add @esf/better-auth-hedera
# or
bun add @esf/better-auth-hedera
```

## Setup

### Server Setup

```typescript
import { betterAuth } from "better-auth";
import { siwh } from "@esf/better-auth-hedera/server";

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
import { siwhClient } from "@esf/better-auth-hedera/client";

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

### Sign In with Ethereum

After generating a nonce and creating a SIWH message, verify the signature to authenticate:

```typescript
const { data, error } = await authClient.siwh.verify({
  message: "Your SIWH message string",
  walletAddress: "0.0.9167913",
  chainId: "hedera:mainnet",
  signature: "The signature from the user's wallet",
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
import { siwhClient } from "@esf/better-auth-hedera/client";

export const authClient = createAuthClient({
  plugins: [
    siwhClient({
      // Optional client configuration can go here
    }),
  ],
});
```

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
import { HederaChainId } from "@esf/better-auth-hedera";

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
