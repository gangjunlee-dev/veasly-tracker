import type { BaseExtractor } from "./BaseExtractor";
import type { ExtractorConfig } from "./types";
import { createLogger } from "../../utils/logger";

const log = createLogger("extractor:registry");

export type ExtractorConstructor = new (
  config: ExtractorConfig
) => BaseExtractor;

type ExtractorModule = {
  default: ExtractorConstructor;
};

type ConfigModule =
  | ExtractorConfig
  | {
      default: ExtractorConfig;
    };

const extractorModules = import.meta.glob("../*/index.ts", {
  eager: true
}) as Record<string, ExtractorModule>;

const configModules = import.meta.glob("../*/config.json", {
  eager: true
}) as Record<string, ConfigModule>;

const registry = new Map<
  string,
  {
    config: ExtractorConfig;
    ExtractorClass: ExtractorConstructor;
  }
>();

function getFolderName(modulePath: string): string {
  const parts = modulePath.split("/");
  return parts[parts.length - 2] ?? "";
}

function normalizeConfig(configModule: ConfigModule): ExtractorConfig {
  if ("default" in configModule) {
    return configModule.default;
  }

  return configModule;
}

export function loadExtractors() {
  registry.clear();

  for (const [modulePath, moduleValue] of Object.entries(extractorModules)) {
    const folder = getFolderName(modulePath);

    if (!folder || folder.startsWith("_")) {
      continue;
    }

    const configPath = `../${folder}/config.json`;
    const configModule = configModules[configPath];

    if (!configModule) {
      log.warn(`config.json missing for ${folder}`);
      continue;
    }

    const config = normalizeConfig(configModule);
    const ExtractorClass = moduleValue.default;

    if (!config.code) {
      log.warn(`code missing for ${folder}`);
      continue;
    }

    registry.set(config.code, {
      config,
      ExtractorClass
    });
  }

  return listExtractors();
}

export function listExtractors(): ExtractorConfig[] {
  return Array.from(registry.values()).map((item) => item.config);
}

export function getExtractor(code: string): BaseExtractor {
  const item = registry.get(code);

  if (!item) {
    throw new Error(`등록되지 않은 추출기입니다: ${code}`);
  }

  return new item.ExtractorClass(item.config);
}

export function hasExtractor(code: string): boolean {
  return registry.has(code);
}
