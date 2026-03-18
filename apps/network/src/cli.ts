#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("network")
  .description("OSM road network data pipeline for Moveet")
  .version("0.1.0");

program.parse();

export function runCLI(): void {
  program.parse();
}
