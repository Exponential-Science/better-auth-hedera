#!/usr/bin/env bun

import { writeFileSync } from "fs";
import { join } from "path";

const distDir = join(import.meta.dir, "..", "dist");

// Create server.d.ts
const serverDts = `export * from "./server/index.js";
`;

// Create client.d.ts
const clientDts = `export * from "./client/index.js";
`;

writeFileSync(join(distDir, "server.d.ts"), serverDts);
writeFileSync(join(distDir, "client.d.ts"), clientDts);

console.log("✅ Type declaration files created");

