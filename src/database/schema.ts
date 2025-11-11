// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Exponential Science Foundation and contributors
import type { BetterAuthPluginDBSchema } from "better-auth/db";

export const schema = {
  walletAddress: {
    fields: {
      userId: {
        type: "string",
        references: {
          model: "user",
          field: "id",
        },
        required: true,
      },
      address: {
        type: "string",
        required: true,
      },
      chainId: {
        type: "string",
        required: true,
      },
      isPrimary: {
        type: "boolean",
        defaultValue: false,
      },
      createdAt: {
        type: "date",
        required: true,
      },
    },
  },
} satisfies BetterAuthPluginDBSchema;
