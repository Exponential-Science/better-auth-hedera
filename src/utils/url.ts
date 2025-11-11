// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Exponential Science Foundation and contributors
export function getOrigin(url: string) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.origin;
  } catch (error) {
    return null;
  }
}
