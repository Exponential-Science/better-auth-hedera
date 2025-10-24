import { APIError } from "better-auth";
import { schema } from "../database/schema";
import { mergeSchema } from "better-auth/db";
import { createAuthEndpoint } from "better-auth/api";
import * as z from "zod";
import { toChecksumAddress } from "../utils/hashing";
import { getOrigin } from "../utils/url";
import { base64ToSignature } from "../utils/signature";
import { HederaChainId } from "../types";
import { BASE_ERROR_CODES } from "better-auth";
import { createEmailVerificationToken } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";

// Types
import type {
  InferOptionSchema,
  BetterAuthPlugin,
  BetterAuthOptions,
  AdditionalUserFieldsInput,
  User,
} from "better-auth";
import type { SIWHVerifyMessageArgs, WalletAddress } from "../types";

export interface SIWHPluginOptions {
  domain: string;
  emailDomainName?: string;
  anonymous?: boolean;
  autoSignUp?: boolean;
  getNonce: () => Promise<string>;
  verifyMessage: (args: SIWHVerifyMessageArgs) => Promise<boolean>;
  schema?: InferOptionSchema<typeof schema>;
}

export const siwh = <O extends BetterAuthOptions>(options: SIWHPluginOptions) =>
  ({
    id: "siwh",
    schema: mergeSchema(schema, options?.schema),
    endpoints: {
      getSiwhNonce: createAuthEndpoint(
        "/siwh/nonce",
        {
          method: "POST",
          body: z.object({
            walletAddress: z
              .string()
              .regex(
                /^(0|(?:[1-9]\d*))\.(0|(?:[1-9]\d*))\.(0|(?:[1-9]\d*))$/,
                "Invalid Hedera account ID format. Expected format: 0.0.123"
              ),
            chainId: z
              .enum([
                HederaChainId.Mainnet,
                HederaChainId.Testnet,
                HederaChainId.Previewnet,
                HederaChainId.Devnet,
              ])
              .optional()
              .default(HederaChainId.Mainnet),
          }),
        },
        async (ctx) => {
          const { walletAddress: rawWalletAddress, chainId } = ctx.body;
          const checksumResult = toChecksumAddress(chainId, rawWalletAddress);

          if (!checksumResult.isValid) {
            throw new APIError("BAD_REQUEST", {
              message: "Invalid wallet address",
              status: 400,
            });
          }

          const walletAddress = checksumResult.withChecksumFormat;
          const nonce = await options.getNonce();

          // Store nonce with wallet address and chain ID context
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: `siwh:${walletAddress}:${chainId}`,
            value: nonce,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          });

          return ctx.json({ nonce });
        }
      ),
      verifySiwhMessage: createAuthEndpoint(
        "/siwh/verify",
        {
          method: "POST",
          body: z
            .object({
              message: z.string().min(1),
              signature: z.string().min(1, "Signature is required"),
              walletAddress: z
                .string()
                .regex(
                  /^(0|(?:[1-9]\d*))\.(0|(?:[1-9]\d*))\.(0|(?:[1-9]\d*))$/,
                  "Invalid Hedera account ID format. Expected format: 0.0.123"
                ),
              chainId: z
                .enum([
                  HederaChainId.Mainnet,
                  HederaChainId.Testnet,
                  HederaChainId.Previewnet,
                  HederaChainId.Devnet,
                ])
                .optional()
                .default(HederaChainId.Mainnet),
              email: z.email().optional(),
              callbackURL: z
                .string()
                .meta({
                  description:
                    "Callback URL to redirect to after the user has signed in",
                })
                .optional(),
              data: z.record(z.string(), z.any()).optional(),
            })
            .refine((data) => options.anonymous !== false || !!data.email, {
              message:
                "Email is required when the anonymous plugin option is disabled.",
              path: ["email"],
            }),
          metadata: {
            $Infer: {
              body: {} as {
                message: string;
                signature: string;
                walletAddress: string;
                chainId: HederaChainId;
                email?: string;
                callbackURL?: string;
                data?: {
                  name: string;
                  password: string;
                } & AdditionalUserFieldsInput<O>;
              },
            },
          },
          requireRequest: true,
        },
        async (ctx) => {
          const {
            message,
            signature: signatureBase64,
            walletAddress: rawWalletAddress,
            chainId,
            email,
            data,
            callbackURL,
          } = ctx.body;

          // Convert base64 signature to Uint8Array
          const signature = base64ToSignature(signatureBase64);

          const checksumResult = toChecksumAddress(chainId, rawWalletAddress);

          if (!checksumResult.isValid) {
            throw new APIError("BAD_REQUEST", {
              message: "Invalid wallet address",
              status: 400,
            });
          }

          const walletAddress = checksumResult.withChecksumFormat;
          const isAnon = options.anonymous ?? true;

          if (!isAnon && !email) {
            throw new APIError("BAD_REQUEST", {
              message: "Email is required when anonymous is disabled.",
              status: 400,
            });
          }

          try {
            // Find stored nonce with wallet address and chain ID context
            const verification =
              await ctx.context.internalAdapter.findVerificationValue(
                `siwh:${walletAddress}:${chainId}`
              );

            // Ensure nonce is valid and not expired
            if (!verification || new Date() > verification.expiresAt) {
              throw new APIError("UNAUTHORIZED", {
                message: "Unauthorized: Invalid or expired nonce",
                status: 401,
                code: "UNAUTHORIZED_INVALID_OR_EXPIRED_NONCE",
              });
            }

            // Verify SIWH message with enhanced parameters
            const { value: nonce } = verification;
            const verified = await options.verifyMessage({
              message,
              signature,
              address: walletAddress,
              chainId,
              cacao: {
                h: { t: "caip122" },
                p: {
                  domain: options.domain,
                  aud: options.domain,
                  nonce,
                  iss: options.domain,
                  version: "1",
                },
                s: {
                  t: "ed25519",
                  s: signature,
                },
              },
            });

            if (!verified) {
              throw new APIError("UNAUTHORIZED", {
                message: "Unauthorized: Invalid SIWH signature",
                status: 401,
              });
            }

            // Clean up used nonce
            await ctx.context.internalAdapter.deleteVerificationValue(
              verification.id
            );

            // Look for existing user by their wallet addresses
            let user: User | null = null;

            // Check if there's a wallet address record for this exact address+chainId combination
            const existingWalletAddress: WalletAddress | null =
              await ctx.context.adapter.findOne({
                model: "walletAddress",
                where: [
                  { field: "address", operator: "eq", value: walletAddress },
                  { field: "chainId", operator: "eq", value: chainId },
                ],
              });

            if (existingWalletAddress) {
              // Get the user associated with this wallet address
              user = await ctx.context.adapter.findOne({
                model: "user",
                where: [
                  {
                    field: "id",
                    operator: "eq",
                    value: existingWalletAddress.userId,
                  },
                ],
              });
            } else {
              // No exact match found, check if this address exists on any other chain
              const anyWalletAddress: WalletAddress | null =
                await ctx.context.adapter.findOne({
                  model: "walletAddress",
                  where: [
                    { field: "address", operator: "eq", value: walletAddress },
                  ],
                });

              if (anyWalletAddress) {
                // Same address exists on different chain, get that user
                user = await ctx.context.adapter.findOne({
                  model: "user",
                  where: [
                    {
                      field: "id",
                      operator: "eq",
                      value: anyWalletAddress.userId,
                    },
                  ],
                });
              }
            }

            if (!user) {
              // No user found, check if auto sign up is enabled
              if (!options.autoSignUp) {
                throw new APIError("UNAUTHORIZED", {
                  message: "Unauthorized: No user found",
                  status: 401,
                });
              }

              // Create new user if none exists
              const domain =
                options.emailDomainName ?? getOrigin(ctx.context.baseURL);
              // Use checksummed address for email generation
              const userEmail =
                !isAnon && email ? email : `${walletAddress}@${domain}`;

              user = await ctx.context.internalAdapter.createUser({
                name: data?.name ?? walletAddress,
                email: userEmail,
              });

              // Create wallet address record
              await ctx.context.adapter.create({
                model: "walletAddress",
                data: {
                  userId: user.id,
                  address: walletAddress,
                  chainId,
                  isPrimary: true, // First address is primary
                  createdAt: new Date(),
                },
              });

              // Create account record for wallet authentication
              await ctx.context.internalAdapter.createAccount({
                userId: user.id,
                providerId: "siwh",
                accountId: `${walletAddress}:${chainId}`,
                createdAt: new Date(),
                updatedAt: new Date(),
              });

              // Create credential account if password is provided
              if (data?.password) {
                const hashedPassword = await ctx.context.password.hash(
                  data.password
                );
                await ctx.context.internalAdapter.linkAccount({
                  userId: user.id,
                  providerId: "credentials",
                  accountId: user.id,
                  password: hashedPassword,
                });
              }

              // Send verification email if required
              if (
                ctx.context.options.emailVerification?.sendOnSignUp ||
                ctx.context.options.emailAndPassword?.requireEmailVerification
              ) {
                const token = await createEmailVerificationToken(
                  ctx.context.secret,
                  user.email,
                  undefined,
                  ctx.context.options.emailVerification?.expiresIn
                );
                const _callbackURL = callbackURL
                  ? encodeURIComponent(callbackURL)
                  : encodeURIComponent("/");
                const url = `${ctx.context.baseURL}/verify-email?token=${token}&callbackURL=${_callbackURL}`;
                const args: Parameters<
                  Required<
                    Required<BetterAuthOptions>["emailVerification"]
                  >["sendVerificationEmail"]
                > = ctx.request
                  ? [
                      {
                        user: user,
                        url,
                        token,
                      },
                      ctx.request,
                    ]
                  : [
                      {
                        user: user,
                        url,
                        token,
                      },
                    ];

                await ctx.context.options.emailVerification?.sendVerificationEmail?.(
                  ...args
                );
              }

              // Return user data on sign up without automatic sign in
              return ctx.json({
                token: null,
                user: {
                  id: user.id,
                  email: user.email,
                  name: user.name,
                  image: user.image,
                  emailVerified: user.emailVerified,
                  createdAt: user.createdAt,
                  updatedAt: user.updatedAt,
                },
              });
            } else {
              // User exists, but check if this specific address/chain combo exists
              if (!existingWalletAddress) {
                // Add this new chainId to existing user's addresses
                await ctx.context.adapter.create({
                  model: "walletAddress",
                  data: {
                    userId: user.id,
                    address: walletAddress,
                    chainId,
                    isPrimary: false, // Additional addresses are not primary by default
                    createdAt: new Date(),
                  },
                });

                // Create account record for this new wallet+chain combination
                await ctx.context.internalAdapter.createAccount({
                  userId: user.id,
                  providerId: "siwh",
                  accountId: `${walletAddress}:${chainId}`,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                });
              }
            }

            const session = await ctx.context.internalAdapter.createSession(
              user.id,
              ctx
            );

            if (!session) {
              throw new APIError("BAD_REQUEST", {
                message: BASE_ERROR_CODES.FAILED_TO_CREATE_SESSION,
              });
            }

            await setSessionCookie(ctx, {
              session,
              user: user,
            });

            return ctx.json({
              redirect: !!callbackURL,
              token: session.token,
              url: callbackURL,
              user: {
                id: user.id,
                email: user.email,
                name: user.name,
                image: user.image,
                emailVerified: user.emailVerified,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt,
              },
            });
          } catch (error: unknown) {
            if (error instanceof APIError) throw error;
            throw new APIError("UNAUTHORIZED", {
              message: "Something went wrong. Please try again later.",
              error: error instanceof Error ? error.message : "Unknown error",
              status: 401,
            });
          }
        }
      ),
    },
  } satisfies BetterAuthPlugin);
