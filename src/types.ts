// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Exponential Science Foundation and contributors
export enum HederaChainId {
  Mainnet = "hedera:mainnet",
  Testnet = "hedera:testnet",
  Previewnet = "hedera:previewnet",
  Devnet = "hedera:devnet",
}

export interface WalletAddress {
  id: string;
  userId: string;
  address: string;
  chainId: number;
  isPrimary: boolean;
  createdAt: Date;
}

interface CacaoHeader {
  t: "caip122";
}

// Signed Cacao (CAIP-74)
interface CacaoPayload {
  domain: string;
  aud: string;
  nonce: string;
  iss: string;
  version?: string;
  iat?: string;
  nbf?: string;
  exp?: string;
  statement?: string;
  requestId?: string;
  resources?: string[];
  type?: string;
}

interface Cacao {
  h: CacaoHeader;
  p: CacaoPayload;
  s: {
    t: "ed25519" | "ecdsa_secp256k1"; // NOT "eip191" or "eip1271"
    s: Uint8Array;
    m?: string;
  };
}

export interface SIWHVerifyMessageArgs {
  message: string;
  signature: Uint8Array;
  address: string;
  chainId: string;
  cacao?: Cacao;
}
