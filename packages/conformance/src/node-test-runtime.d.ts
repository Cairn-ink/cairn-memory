declare module "node:test" {
  export function test(name: string, run: (context: { skip(message: string): void }) => Promise<void>): void;
}
