// @ts-expect-error Explicit TS extension also supports the standalone Node helper tests.
import { crawlerMessages } from "./availability-crawler-messages.ts";
// @ts-expect-error Explicit TS extension also supports the standalone Node helper tests.
import { crawlerHelperMessages, type CrawlerTranslator } from "./availability-crawler-helper-messages.ts";
import type { AvailabilityCrawlerDashboardRow } from "./types";

export type CrawlerErrorOrigin = "backend" | "source";

type CrawlerSearchSource = Pick<AvailabilityCrawlerDashboardRow,
  "building_name" | "area" | "city" | "state" | "provider_key" | "provider_label"
  | "parser_strategy" | "provider_status" | "availability_url" | "website"
>;

const genericProviders = new Map<string, { messageKey: keyof typeof crawlerMessages.en; aliases: string[] }>([
  ["official", { messageKey: "providerOfficial", aliases: ["official", "official site"] }],
  ["official_site", { messageKey: "providerOfficial", aliases: ["official", "official site"] }],
  ["official_next_data", { messageKey: "providerStructured", aliases: ["official next.js data"] }],
  ["third_party_ils", { messageKey: "providerThirdParty", aliases: ["third-party ils"] }],
  ["unknown", { messageKey: "providerUnknown", aliases: [] }],
]);

export function providerLabel(label: string | null, key: string, t: CrawlerTranslator) {
  const generic = genericProviders.get(key);
  if (generic) {
    const normalizedLabel = label?.trim().toLowerCase().replaceAll("_", " ");
    const aliases = [key.replaceAll("_", " "), ...generic.aliases,
      crawlerMessages.en[generic.messageKey].toLowerCase(), crawlerMessages.zh[generic.messageKey]];
    if (!normalizedLabel || aliases.includes(normalizedLabel)) return t(`crawler.${generic.messageKey}`);
  }
  return label || key.replaceAll("_", " ");
}

export function strategyLabel(strategy: string, t: CrawlerTranslator) {
  const keys: Record<string, string> = {
    official_anchor: "strategyOfficialAnchor", official_inline: "strategyOfficialInline",
    official_json_map: "strategyOfficialJSON", official_units_api: "strategyOfficialAPI",
    official_floorplan: "strategyFloorplan", official_floorplan_click: "strategyFloorplanClick",
    generic_official: "strategyGeneric", next_data_floorplan_summary: "strategyNext",
    realpage_unit_api: "strategyRealpageAPI", veris_properties_query: "strategyVeris",
    unavailable: "strategyUnavailable", unsupported: "strategyUnsupported",
  };
  if (keys[strategy]) return t(`crawler.${keys[strategy]}`);
  const providers: Record<string, string> = {
    yardi_rentcafe: "Yardi RentCafe", entrata: "Entrata", realpage: "RealPage",
    realtydatatrust: "Realty Data Trust", appfolio: "AppFolio", blt_liveworkplay: "BLT",
    greystar: "Greystar", bozzuto: "Bozzuto", tfc: "TFC", related_rentals: "Related Rentals",
    rockrose: "Rockrose", urbanapt_nestio: "Urban / Nestio", stellar_management: "Stellar Management",
    mriprospectconnect: "MRI Prospect Connect", elise_ai: "EliseAI", modernspaces: "Modern Spaces",
  };
  return providers[strategy] ? t("crawler.strategyPlatform", { provider: providers[strategy] }) : t("crawler.strategyOther");
}

// Index both languages, so changing the display language never changes a saved query's matches.
const searchTranslators: CrawlerTranslator[] = Object.values(crawlerMessages).map((dictionary) => (key, params) => {
  const name = key.slice("crawler.".length) as keyof typeof dictionary;
  const template = dictionary[name] ?? key;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => (
    params && Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder
  ));
});

export function sourceMatchesSearchQuery(source: CrawlerSearchSource, normalizedQuery: string) {
  const haystack = [
    source.building_name,
    source.area,
    source.city,
    source.state,
    source.provider_key,
    source.provider_label,
    source.parser_strategy,
    source.provider_status,
    source.availability_url,
    source.website,
    ...searchTranslators.flatMap((t) => [
      providerLabel(source.provider_label, source.provider_key, t),
      strategyLabel(source.parser_strategy, t),
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

export function describeCrawlerError(error: string, origin: CrawlerErrorOrigin = "backend") {
  const localKey = (error.startsWith("crawler.")
    && Object.prototype.hasOwnProperty.call(crawlerMessages.en, error.slice("crawler.".length)))
    || (error.startsWith("crawlerHelpers.")
    && Object.prototype.hasOwnProperty.call(crawlerHelperMessages.en, error.slice("crawlerHelpers.".length)));
  const key = localKey ? error
    : /(?:column|relation|function).*availability_.*(?:does not exist|schema cache)/i.test(error) ? "crawler.schemaOutdated"
    : /preview_fingerprint_changed/.test(error) ? "crawler.previewChanged"
    : /\b403\b|permission denied|not authorized/i.test(error)
      ? origin === "source" ? "crawler.sourceAccessDenied" : "crawler.permissionDenied"
    : /failed to fetch|network error/i.test(error) ? "crawler.networkError"
    : "crawler.requestFailed";
  return { key, details: localKey ? null : error };
}
