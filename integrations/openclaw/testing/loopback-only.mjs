import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  // Node normalizes connection arguments into an array for internal transports.
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof options === "object" ? options.host : typeof args[1] === "string" ? args[1] : "localhost";
  if (typeof options === "object" && options.path) throw new Error("test_non_loopback_blocked");
  if (host && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) throw new Error("test_non_loopback_blocked");
  return Reflect.apply(connect, this, args);
};
syncBuiltinESMExports();
