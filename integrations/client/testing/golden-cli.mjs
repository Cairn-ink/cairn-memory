import { generateMainGolden, verifyMainGolden } from "./main-golden.mjs";
const fixture = new URL("../test/fixtures/claude-hosted-3a1c17d9.json", import.meta.url);
if (process.argv[2] === "--verify") await verifyMainGolden(fixture);
else if (process.argv[2] === "--generate") await generateMainGolden(fixture);
else throw new Error("expected_--verify_or_--generate");
