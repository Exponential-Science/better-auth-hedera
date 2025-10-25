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
import { sessionMiddleware } from "better-auth/api";

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
              isSignUp: z.boolean().optional().default(false),
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
                isSignUp?: boolean;
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
            isSignUp,
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
                message: "Invalid or expired nonce",
                status: 401,
              });
            }

            // Verify SIWH message with enhanced parameters
            const { value: nonce } = verification;
            const verified = await options.verifyMessage({
              message,
              signature,
              address: rawWalletAddress,
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
                message: "Invalid SIWH signature",
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
              if (!options.autoSignUp && !isSignUp) {
                throw new APIError("UNAUTHORIZED", {
                  message: BASE_ERROR_CODES.USER_NOT_FOUND,
                  status: 401,
                });
              }

              // Create new user if none exists
              const domain =
                options.emailDomainName ?? getOrigin(ctx.context.baseURL);

              // Use checksummed address for email generation
              const userEmail =
                !isAnon && email ? email : `${walletAddress}@${domain}`;

              // Check if user with this email already exists
              const dbUser = await ctx.context.internalAdapter.findUserByEmail(
                userEmail
              );
              if (dbUser?.user) {
                throw new APIError("UNPROCESSABLE_ENTITY", {
                  message:
                    BASE_ERROR_CODES.USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL,
                });
              }

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
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Something went wrong. Please try again later.",
              error: error instanceof Error ? error.message : "Unknown error",
              status: 500,
            });
          }
        }
      ),
      linkSiwhWallet: createAuthEndpoint(
        "/siwh/link",
        {
          method: "POST",
          requireHeaders: true,
          body: z.object({
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
          }),
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const {
            message,
            signature: signatureBase64,
            walletAddress: rawWalletAddress,
            chainId,
          } = ctx.body;

          // 1. Get and validate current user session
          const session = ctx.context.session;
          if (!session?.user) {
            throw new APIError("UNAUTHORIZED", {
              message: "You must be signed in to link a wallet",
              status: 401,
            });
          }

          // 2. Prevent anonymous users from linking wallets
          if (session.user?.isAnonymous) {
            throw new APIError("FORBIDDEN", {
              message:
                "Anonymous users cannot link wallets. Please create a permanent account first.",
              status: 403,
            });
          }

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

          try {
            // 3. Find stored nonce with wallet address and chain ID context
            const verification =
              await ctx.context.internalAdapter.findVerificationValue(
                `siwh:${walletAddress}:${chainId}`
              );

            // Ensure nonce is valid and not expired
            if (!verification || new Date() > verification.expiresAt) {
              throw new APIError("UNAUTHORIZED", {
                message: "Invalid or expired nonce",
                status: 401,
              });
            }

            // 4. Verify SIWH message
            const { value: nonce } = verification;
            const verified = await options.verifyMessage({
              message,
              signature,
              address: rawWalletAddress,
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
                message: "Invalid SIWH signature",
                status: 401,
              });
            }

            // Clean up used nonce
            await ctx.context.internalAdapter.deleteVerificationValue(
              verification.id
            );

            // 5. Check if wallet is already linked to ANY user
            const existingWallet: WalletAddress | null =
              await ctx.context.adapter.findOne({
                model: "walletAddress",
                where: [
                  { field: "address", operator: "eq", value: walletAddress },
                  { field: "chainId", operator: "eq", value: chainId },
                ],
              });

            if (existingWallet) {
              if (existingWallet.userId === session.user.id) {
                throw new APIError("BAD_REQUEST", {
                  message: "This wallet is already linked to your account",
                  status: 400,
                });
              } else {
                throw new APIError("CONFLICT", {
                  message: "This wallet is already linked to another account",
                  status: 409,
                });
              }
            }

            // 6. Link wallet to current user
            await ctx.context.adapter.create({
              model: "walletAddress",
              data: {
                userId: session.user.id,
                address: walletAddress,
                chainId,
                isPrimary: false, // Linked wallets are not primary by default
                createdAt: new Date(),
              },
            });

            // 7. Create account record for this wallet+chain combination
            await ctx.context.internalAdapter.createAccount({
              userId: session.user.id,
              providerId: "siwh",
              accountId: `${walletAddress}:${chainId}`,
              createdAt: new Date(),
              updatedAt: new Date(),
            });

            return ctx.json({
              success: true,
              walletAddress,
              chainId,
            });
          } catch (error: unknown) {
            if (error instanceof APIError) throw error;
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Something went wrong. Please try again later.",
              error: error instanceof Error ? error.message : "Unknown error",
              status: 500,
            });
          }
        }
      ),
      unlinkSiwhWallet: createAuthEndpoint(
        "/siwh/unlink",
        {
          method: "POST",
          requireHeaders: true,
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
          use: [sessionMiddleware],
        },
        async (ctx) => {
          const { walletAddress: rawWalletAddress, chainId } = ctx.body;

          // 1. Get and validate current user session
          const session = ctx.context.session;
          if (!session?.user) {
            throw new APIError("UNAUTHORIZED", {
              message: "You must be signed in to link a wallet",
              status: 401,
            });
          }

          const checksumResult = toChecksumAddress(chainId, rawWalletAddress);

          if (!checksumResult.isValid) {
            throw new APIError("BAD_REQUEST", {
              message: "Invalid wallet address",
              status: 400,
            });
          }

          const walletAddress = checksumResult.withChecksumFormat;

          try {
            const accounts = await ctx.context.internalAdapter.findAccounts(
              ctx.context.session.user.id
            );
            if (
              accounts.length === 1 &&
              !ctx.context.options.account?.accountLinking?.allowUnlinkingAll
            ) {
              throw new APIError("BAD_REQUEST", {
                message: BASE_ERROR_CODES.FAILED_TO_UNLINK_LAST_ACCOUNT,
              });
            }

            const accountExist = accounts.find(
              (account) =>
                account.accountId === walletAddress &&
                account.providerId === "siwh"
            );
            if (!accountExist) {
              throw new APIError("BAD_REQUEST", {
                message: BASE_ERROR_CODES.ACCOUNT_NOT_FOUND,
              });
            }

            await ctx.context.internalAdapter.deleteAccount(accountExist.id);
            await ctx.context.adapter.delete({
              model: "walletAddress",
              where: [
                { field: "address", operator: "eq", value: walletAddress },
                { field: "chainId", operator: "eq", value: chainId },
              ],
            });

            return ctx.json({
              status: true,
            });
          } catch (error: unknown) {
            if (error instanceof APIError) throw error;
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Something went wrong. Please try again later.",
              error: error instanceof Error ? error.message : "Unknown error",
              status: 500,
            });
          }
        }
      ),
    },
  } satisfies BetterAuthPlugin);
