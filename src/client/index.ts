import type { siwh } from "../server";
import type { BetterAuthClientPlugin } from "better-auth";

export const siwhClient = () => {
  return {
    id: "siwh",
    $InferServerPlugin: {} as ReturnType<typeof siwh>,
  } satisfies BetterAuthClientPlugin;
};
