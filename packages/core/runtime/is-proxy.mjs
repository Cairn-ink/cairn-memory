import { types } from "node:util";

// Detect even transparent and revoked proxies without running their traps.
export const isProxy = types.isProxy;
