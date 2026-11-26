import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["node:sqlite", "@pydantic/monty"],
  devIndicators: false,
};
export default config;
