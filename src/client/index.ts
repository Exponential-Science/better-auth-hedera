// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Exponential Science Foundation and contributors
import type { siwh } from "../server";
import type { BetterAuthClientPlugin } from "better-auth";

export const siwhClient = () => {
  return {
    id: "siwh",
    $InferServerPlugin: {} as ReturnType<typeof siwh>,
  } satisfies BetterAuthClientPlugin;
};
