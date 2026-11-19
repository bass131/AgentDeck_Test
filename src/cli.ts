#!/usr/bin/env node
// 얇은 껍데기다. 검사 로직은 check.ts의 run이 맡고, 여기서는 결과를 실제 스트림과 exit 코드로 옮긴다.
import { run } from "./check.js";

const result = run(process.argv.slice(2));
if (result.stdout !== "") process.stdout.write(result.stdout);
if (result.stderr !== "") process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
