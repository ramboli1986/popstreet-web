"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, Brain, RotateCcw, Save, ShieldCheck, SlidersHorizontal, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type AIProvider = "openai" | "anthropic" | "custom";
type ResponseLanguage = "auto" | "en" | "zh";
type AITone = "concise" | "friendly" | "sales";

type AIConfig = {
  provider: AIProvider;
  model: string;
  responseLanguage: ResponseLanguage;
  tone: AITone;
  creativity: number;
  budgetWeight: number;
  cashbackWeight: number;
  commuteWeight: number;
  amenityWeight: number;
  defaultPrompt: string;
  guardrails: string;
  enableAiSearch: boolean;
  enableDealSummary: boolean;
  enableTourFollowup: boolean;
  enableAdminCopilot: boolean;
};

const configStorageKey = "popstreet.ai.config";

const baseDefaultConfig: AIConfig = {
  provider: "openai",
  model: "gpt-4.1-mini",
  responseLanguage: "auto",
  tone: "friendly",
  creativity: 32,
  budgetWeight: 82,
  cashbackWeight: 68,
  commuteWeight: 56,
  amenityWeight: 44,
  defaultPrompt:
    "Help renters find apartments that fit budget, move-in timing, commute, lifestyle needs, and available concessions.",
  guardrails:
    "Be transparent about prices and availability. Do not guarantee inventory. Ask clarifying questions when the request is ambiguous.",
  enableAiSearch: true,
  enableDealSummary: true,
  enableTourFollowup: false,
  enableAdminCopilot: true
};

export function AIConfigPage() {
  const { t } = useI18n();
  const [config, setConfig] = useState<AIConfig>(baseDefaultConfig);
  const [message, setMessage] = useState<string | null>(null);

  const localizedDefaultConfig = useMemo(
    () => ({
      ...baseDefaultConfig,
      defaultPrompt: t("aiConfig.defaultPromptValue"),
      guardrails: t("aiConfig.guardrailsValue")
    }),
    [t]
  );

  useEffect(() => {
    const savedConfig = window.localStorage.getItem(configStorageKey);

    if (!savedConfig) {
      setConfig(localizedDefaultConfig);
      return;
    }

    try {
      setConfig({ ...localizedDefaultConfig, ...(JSON.parse(savedConfig) as Partial<AIConfig>) });
    } catch {
      setConfig(localizedDefaultConfig);
    }
  }, [localizedDefaultConfig]);

  function updateConfig<K extends keyof AIConfig>(key: K, value: AIConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
    setMessage(null);
  }

  function saveConfig() {
    window.localStorage.setItem(configStorageKey, JSON.stringify(config));
    setMessage(t("aiConfig.saved"));
  }

  function resetConfig() {
    window.localStorage.removeItem(configStorageKey);
    setConfig(localizedDefaultConfig);
    setMessage(t("aiConfig.resetDone"));
  }

  const enabledSurfaceCount = [
    config.enableAiSearch,
    config.enableDealSummary,
    config.enableTourFollowup,
    config.enableAdminCopilot
  ].filter(Boolean).length;

  return (
    <div className="ai-config-page">
      <div className="page-hero">
        <div>
          <div className="eyebrow">{t("aiConfig.eyebrow")}</div>
          <h1>{t("aiConfig.title")}</h1>
          <p>{t("aiConfig.subtitle")}</p>
        </div>
        <div className="page-actions">
          <button className="ghost-button" onClick={resetConfig} type="button">
            <RotateCcw size={16} />
            {t("aiConfig.reset")}
          </button>
          <button className="button dark-button" onClick={saveConfig} type="button">
            <Save size={16} />
            {t("aiConfig.save")}
          </button>
        </div>
      </div>

      {message ? <div className="message compact-message">{message}</div> : null}

      <section className="ai-status-grid">
        <article className="ai-status-card">
          <Bot size={18} />
          <div>
            <span>{t("aiConfig.liveStatus")}</span>
            <strong>{t("aiConfig.localDraft")}</strong>
          </div>
        </article>
        <article className="ai-status-card">
          <Brain size={18} />
          <div>
            <span>{t("aiConfig.providerModel")}</span>
            <strong>
              {config.provider} · {config.model}
            </strong>
          </div>
        </article>
        <article className="ai-status-card">
          <Sparkles size={18} />
          <div>
            <span>{t("aiConfig.appSurfaces")}</span>
            <strong>
              {enabledSurfaceCount} / 4 {t("common.enabled")}
            </strong>
          </div>
        </article>
        <article className="ai-status-card muted-card">
          <ShieldCheck size={18} />
          <div>
            <span>{t("common.disabled")}</span>
            <strong>{t("aiConfig.notConnected")}</strong>
          </div>
        </article>
      </section>

      <section className="ai-config-grid">
        <article className="analytics-card ai-config-card">
          <div className="card-heading">
            <div>
              <div className="eyebrow">{t("aiConfig.providerModel")}</div>
              <h3>{t("aiConfig.providerModel")}</h3>
            </div>
            <Bot size={18} />
          </div>
          <div className="ai-card-body ai-form-grid">
            <label className="field">
              <span>{t("aiConfig.provider")}</span>
              <select value={config.provider} onChange={(event) => updateConfig("provider", event.target.value as AIProvider)}>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="custom">Custom API</option>
              </select>
            </label>
            <label className="field">
              <span>{t("aiConfig.model")}</span>
              <input value={config.model} onChange={(event) => updateConfig("model", event.target.value)} />
            </label>
            <label className="field">
              <span>{t("aiConfig.responseLanguage")}</span>
              <select
                value={config.responseLanguage}
                onChange={(event) => updateConfig("responseLanguage", event.target.value as ResponseLanguage)}
              >
                <option value="auto">{t("aiConfig.responseAuto")}</option>
                <option value="en">{t("aiConfig.responseEnglish")}</option>
                <option value="zh">{t("aiConfig.responseChinese")}</option>
              </select>
            </label>
            <label className="field">
              <span>{t("aiConfig.tone")}</span>
              <select value={config.tone} onChange={(event) => updateConfig("tone", event.target.value as AITone)}>
                <option value="concise">{t("aiConfig.toneConcise")}</option>
                <option value="friendly">{t("aiConfig.toneFriendly")}</option>
                <option value="sales">{t("aiConfig.toneSales")}</option>
              </select>
            </label>
            <SliderField
              label={t("aiConfig.creativity")}
              value={config.creativity}
              onChange={(value) => updateConfig("creativity", value)}
            />
          </div>
        </article>

        <article className="analytics-card ai-config-card">
          <div className="card-heading">
            <div>
              <div className="eyebrow">{t("aiConfig.rankingWeights")}</div>
              <h3>{t("aiConfig.rankingWeights")}</h3>
            </div>
            <SlidersHorizontal size={18} />
          </div>
          <div className="ai-card-body">
            <SliderField
              label={t("aiConfig.budgetFit")}
              value={config.budgetWeight}
              onChange={(value) => updateConfig("budgetWeight", value)}
            />
            <SliderField
              label={t("aiConfig.cashback")}
              value={config.cashbackWeight}
              onChange={(value) => updateConfig("cashbackWeight", value)}
            />
            <SliderField
              label={t("aiConfig.commute")}
              value={config.commuteWeight}
              onChange={(value) => updateConfig("commuteWeight", value)}
            />
            <SliderField
              label={t("aiConfig.amenities")}
              value={config.amenityWeight}
              onChange={(value) => updateConfig("amenityWeight", value)}
            />
          </div>
        </article>

        <article className="analytics-card ai-config-card">
          <div className="card-heading">
            <div>
              <div className="eyebrow">{t("aiConfig.appSurfaces")}</div>
              <h3>{t("aiConfig.appSurfaces")}</h3>
            </div>
            <Sparkles size={18} />
          </div>
          <div className="ai-card-body ai-toggle-list">
            <ToggleRow
              checked={config.enableAiSearch}
              description={t("aiConfig.aiSearchDesc")}
              label={t("aiConfig.aiSearch")}
              onChange={(value) => updateConfig("enableAiSearch", value)}
            />
            <ToggleRow
              checked={config.enableDealSummary}
              description={t("aiConfig.dealSummaryDesc")}
              label={t("aiConfig.dealSummary")}
              onChange={(value) => updateConfig("enableDealSummary", value)}
            />
            <ToggleRow
              checked={config.enableTourFollowup}
              description={t("aiConfig.tourFollowupDesc")}
              label={t("aiConfig.tourFollowup")}
              onChange={(value) => updateConfig("enableTourFollowup", value)}
            />
            <ToggleRow
              checked={config.enableAdminCopilot}
              description={t("aiConfig.adminCopilotDesc")}
              label={t("aiConfig.adminCopilot")}
              onChange={(value) => updateConfig("enableAdminCopilot", value)}
            />
          </div>
        </article>

        <article className="analytics-card ai-config-card ai-prompt-card">
          <div className="card-heading">
            <div>
              <div className="eyebrow">{t("aiConfig.prompts")}</div>
              <h3>{t("aiConfig.prompts")}</h3>
            </div>
            <ShieldCheck size={18} />
          </div>
          <div className="ai-card-body">
            <label className="field">
              <span>{t("aiConfig.defaultPrompt")}</span>
              <textarea value={config.defaultPrompt} onChange={(event) => updateConfig("defaultPrompt", event.target.value)} />
            </label>
            <label className="field">
              <span>{t("aiConfig.guardrails")}</span>
              <textarea value={config.guardrails} onChange={(event) => updateConfig("guardrails", event.target.value)} />
            </label>
            <div className="ai-preview">
              <div className="eyebrow">{t("aiConfig.preview")}</div>
              <strong>{t("aiConfig.previewTitle")}</strong>
              <p>{t("aiConfig.previewBody")}</p>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}

function SliderField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="ai-slider-row">
      <span>
        {label}
        <strong>{value}</strong>
      </span>
      <input min={0} max={100} type="range" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function ToggleRow({
  checked,
  description,
  label,
  onChange
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="ai-toggle-row">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="ai-toggle-control" aria-hidden="true" />
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}
