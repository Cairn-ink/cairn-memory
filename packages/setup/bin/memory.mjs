#!/usr/bin/env node
import { main } from '../lib/setup.mjs';

process.exitCode = await main(process.argv.slice(2));
