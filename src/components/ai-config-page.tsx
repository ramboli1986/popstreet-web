"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Brain, Clipboard, FileText, PlayCircle, RefreshCw, RotateCcw, Save, ShieldCheck, Sparkles, WandSparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useI18n } from "@/lib/i18n";
import type { AccountProfile } from "@/lib/types";
import { canManageAccounts } from "@/lib/format";

const CONFIG_ID = "00000000-0000-4000-8000-000000000001";

type AISearchConfig = {
  id: string;
  enabled: boolean;
  model: string;
  max_output_tokens: number;
  response_language_override: string | null;
  system_prompt_addendum: string;
  disabled_message: string;
  updated_at: string;
  updated_by: string | null;
};

const defaultConfig: AISearchConfig = {
  id: CONFIG_ID,
  enabled: true,
  model: "gpt-5.4-mini",
  max_output_tokens: 500,
  response_language_override: null,
  system_prompt_addendum: "",
  disabled_message: "AI search is temporarily off. Please use the manual filters in Explore.",
  updated_at: new Date().toISOString(),
  updated_by: null,
};

type PromptSnapshot = {
  prompt_version: string;
  prompt_source: string;
  base_prompt: string;
  system_prompt_addendum: string;
  effective_prompt: string;
  model: string;
  max_output_tokens: number;
  response_language_override: string | null;
  enabled: boolean;
};

const localMarketNotesTemplate = `Local market notes:
- Long Island City / Queens Plaza: In the last 1-2 years, Queens Plaza / Court Square has added many restaurants and daily-life amenities. Transit is extremely convenient, but rents have risen noticeably. Recommend it for users who want convenience, newer buildings, and fast Manhattan access; mention the price trade-off.
- Jersey City Downtown: Convenient PATH access, strong restaurant and daily-life options, and good value compared with many Manhattan areas. Recommend it when users accept PATH/NJ for better deals or more space.
- Newport: Waterfront environment, river views, parks, and a cleaner/quieter feel. Recommend it for users who care about riverfront lifestyle and PATH commute; trade-off is less dense nightlife than Downtown Jersey City.`;

type LanguageOption = "" | "en" | "zh" | "es" | "fr" | "ja" | "ko";
const languageOptions: { value: LanguageOption; label: string }[] = [
  { value: "", label: "Follow user" },
  { value: "en", label: "English" },
  { value: "zh", label: "中文" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
];

type AIConfigPageProps = {
  profile: AccountProfile | null;
};

export function AIConfigPage({ profile }: AIConfigPageProps = { profile: null }) {
  const { t } = useI18n();
  const [config, setConfig] = useState<AISearchConfig>(defaultConfig);
  const [draft, setDraft] = useState<AISearchConfig>(defaultConfig);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncingPrompt, setIsSyncingPrompt] = useState(false);
  const [promptSnapshot, setPromptSnapshot] = useState<PromptSnapshot | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canEdit = canManageAccounts(profile?.role, profile?.account_kind);
  const isDirty = JSON.stringify(draft) !== JSON.stringify(config);

  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    const { data, error } = await supabase
      .from("ai_search_configs")
      .select("*")
      .eq("id", CONFIG_ID)
      .maybeSingle();

    if (error) {
      setErrorMessage(error.message);
      setIsLoading(false);
      return;
    }

    const next = (data as AISearchConfig | null) ?? defaultConfig;
    setConfig(next);
    setDraft(next);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  function update<K extends keyof AISearchConfig>(key: K, value: AISearchConfig[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setMessage(null);
    setErrorMessage(null);
  }

  async function save() {
    if (!canEdit) {
      setErrorMessage(t("aiConfig.noPermission"));
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setMessage(null);

    const tokensNumber = Number(draft.max_output_tokens);
    if (!Number.isFinite(tokensNumber) || tokensNumber < 100 || tokensNumber > 4000) {
      setErrorMessage(t("aiConfig.tokensRange"));
      setIsSaving(false);
      return;
    }

    const payload = {
      id: CONFIG_ID,
      enabled: draft.enabled,
      model: draft.model.trim() || defaultConfig.model,
      max_output_tokens: Math.round(tokensNumber),
      response_language_override: draft.response_language_override?.trim() || null,
      system_prompt_addendum: draft.system_prompt_addendum,
      disabled_message: draft.disabled_message.trim() || defaultConfig.disabled_message,
      updated_by: profile?.id ?? null,
    };

    const { data, error } = await supabase
      .from("ai_search_configs")
      .upsert(payload, { onConflict: "id" })
      .select("*")
      .single();

    setIsSaving(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    const next = data as AISearchConfig;
    setConfig(next);
    setDraft(next);
    setMessage(t("aiConfig.saved"));
  }

  function resetDraft() {
    setDraft(config);
    setMessage(null);
    setErrorMessage(null);
  }

  async function syncPromptSnapshot() {
    setIsSyncingPrompt(true);
    setErrorMessage(null);
    setMessage(null);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      setErrorMessage("Supabase env not configured.");
      setIsSyncingPrompt(false);
      return;
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        setErrorMessage("Admin session is required to sync the live prompt.");
        setIsSyncingPrompt(false);
        return;
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/ai-search?admin_prompt=1`, {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const body = (await response.json()) as PromptSnapshot | { error?: string };
      if (!response.ok) {
        setErrorMessage("error" in body && body.error ? body.error : `HTTP ${response.status}`);
        return;
      }

      const snapshot = body as PromptSnapshot;
      setPromptSnapshot(snapshot);
      setConfig((prev) => ({ ...prev, system_prompt_addendum: snapshot.system_prompt_addendum }));
      setDraft((prev) => ({ ...prev, system_prompt_addendum: snapshot.system_prompt_addendum }));
      setMessage(t("aiConfig.promptSynced"));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not sync prompt.");
    } finally {
      setIsSyncingPrompt(false);
    }
  }

  async function copyPromptToClipboard(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(t("aiConfig.promptCopied"));
      setErrorMessage(null);
    } catch {
      setErrorMessage(t("aiConfig.copyFailed"));
    }
  }

  function insertMarketNotesTemplate() {
    update(
      "system_prompt_addendum",
      draft.system_prompt_addendum.trim()
        ? `${draft.system_prompt_addendum.trim()}\n\n${localMarketNotesTemplate}`
        : localMarketNotesTemplate
    );
  }

  return (
    <div className="ai-config-page">
      <div className="page-hero">
        <div>
          <div className="eyebrow">{t("aiConfig.eyebrow")}</div>
          <h1>{t("aiConfig.title")}</h1>
          <p>{t("aiConfig.subtitle")}</p>
        </div>
        <div className="page-actions">
          <button className="ghost-button" onClick={resetDraft} type="button" disabled={!isDirty || isSaving}>
            <RotateCcw size={16} />
            {t("aiConfig.revert")}
          </button>
          <button
            className="button dark-button"
            onClick={save}
            type="button"
            disabled={!isDirty || isSaving || !canEdit}
          >
            <Save size={16} />
            {isSaving ? t("aiConfig.saving") : t("aiConfig.save")}
          </button>
        </div>
      </div>

      {!canEdit ? <div className="message compact-message">{t("aiConfig.viewerOnly")}</div> : null}
      {message ? <div className="message compact-message">{message}</div> : null}
      {errorMessage ? <div className="message compact-message error">{errorMessage}</div> : null}

      <section className="ai-status-grid">
        <article className="ai-status-card">
          <Bot size={18} />
          <div>
            <span>{t("aiConfig.liveStatus")}</span>
            <strong>{config.enabled ? t("aiConfig.statusOn") : t("aiConfig.statusOff")}</strong>
          </div>
        </article>
        <article className="ai-status-card">
          <Brain size={18} />
          <div>
            <span>{t("aiConfig.model")}</span>
            <strong>{config.model}</strong>
          </div>
        </article>
        <article className="ai-status-card">
          <Sparkles size={18} />
          <div>
            <span>{t("aiConfig.maxOutputTokens")}</span>
            <strong>{config.max_output_tokens}</strong>
          </div>
        </article>
        <article className="ai-status-card muted-card">
          <ShieldCheck size={18} />
          <div>
            <span>{t("aiConfig.lastUpdated")}</span>
            <strong>{new Date(config.updated_at).toLocaleString()}</strong>
          </div>
        </article>
      </section>

      <section className="ai-config-grid">
        <article className="analytics-card ai-config-card">
          <div className="card-heading">
            <div>
              <div className="eyebrow">{t("aiConfig.runtime")}</div>
              <h3>{t("aiConfig.runtime")}</h3>
            </div>
            <Brain size={18} />
          </div>
          <div className="ai-card-body ai-form-grid">
            <label className="ai-toggle-row">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => update("enabled", event.target.checked)}
                disabled={!canEdit}
              />
              <span className="ai-toggle-control" aria-hidden="true" />
              <span>
                <strong>{t("aiConfig.enableLabel")}</strong>
                <small>{t("aiConfig.enableDesc")}</small>
              </span>
            </label>

            <label className="field">
              <span>{t("aiConfig.model")}</span>
              <input
                value={draft.model}
                onChange={(event) => update("model", event.target.value)}
                placeholder="gpt-5.4-mini"
                disabled={!canEdit}
              />
              <small>{t("aiConfig.modelHint")}</small>
            </label>

            <label className="field">
              <span>{t("aiConfig.maxOutputTokens")}</span>
              <input
                type="number"
                min={100}
                max={4000}
                value={draft.max_output_tokens}
                onChange={(event) => update("max_output_tokens", Number(event.target.value))}
                disabled={!canEdit}
              />
              <small>{t("aiConfig.maxOutputTokensHint")}</small>
            </label>

            <label className="field">
              <span>{t("aiConfig.responseLanguageOverride")}</span>
              <select
                value={draft.response_language_override ?? ""}
                onChange={(event) =>
                  update("response_language_override", event.target.value ? (event.target.value as LanguageOption) : null)
                }
                disabled={!canEdit}
              >
                {languageOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <small>{t("aiConfig.responseLanguageHint")}</small>
            </label>
          </div>
        </article>

        <article className="analytics-card ai-config-card ai-prompt-card">
          <div className="card-heading">
            <div>
              <div className="eyebrow">{t("aiConfig.prompts")}</div>
              <h3>{t("aiConfig.prompts")}</h3>
            </div>
            <FileText size={18} />
          </div>
          <div className="ai-card-body">
            <div className="ai-prompt-toolbar">
              <div>
                <strong>{t("aiConfig.promptSource")}</strong>
                <span>
                  {promptSnapshot
                    ? `${promptSnapshot.prompt_source} · ${promptSnapshot.prompt_version}`
                    : t("aiConfig.promptSourceHint")}
                </span>
              </div>
              <div className="ai-prompt-actions">
                <button className="ghost-button" onClick={syncPromptSnapshot} type="button" disabled={isSyncingPrompt}>
                  <RefreshCw size={15} />
                  {isSyncingPrompt ? t("aiConfig.syncingPrompt") : t("aiConfig.syncPrompt")}
                </button>
                <button className="ghost-button" onClick={insertMarketNotesTemplate} type="button" disabled={!canEdit}>
                  <WandSparkles size={15} />
                  {t("aiConfig.insertMarketNotes")}
                </button>
                <button
                  className="ghost-button"
                  onClick={() => copyPromptToClipboard(promptSnapshot?.effective_prompt ?? draft.system_prompt_addendum)}
                  type="button"
                  disabled={!promptSnapshot && !draft.system_prompt_addendum.trim()}
                >
                  <Clipboard size={15} />
                  {t("aiConfig.copyEffectivePrompt")}
                </button>
              </div>
            </div>

            {promptSnapshot ? (
              <div className="ai-prompt-meta-grid">
                <div>
                  <span>{t("aiConfig.promptVersion")}</span>
                  <strong>{promptSnapshot.prompt_version}</strong>
                </div>
                <div>
                  <span>{t("aiConfig.liveModel")}</span>
                  <strong>{promptSnapshot.model}</strong>
                </div>
                <div>
                  <span>{t("aiConfig.effectivePromptLength")}</span>
                  <strong>{promptSnapshot.effective_prompt.length.toLocaleString()} chars</strong>
                </div>
              </div>
            ) : null}

            <label className="field">
              <span>{t("aiConfig.addendum")}</span>
              <textarea
                value={draft.system_prompt_addendum}
                onChange={(event) => update("system_prompt_addendum", event.target.value)}
                placeholder={t("aiConfig.addendumPlaceholder")}
                rows={6}
                disabled={!canEdit}
              />
              <small>{t("aiConfig.addendumHint")}</small>
            </label>

            {promptSnapshot ? (
              <div className="ai-prompt-preview-grid">
                <label className="field">
                  <span>{t("aiConfig.basePrompt")}</span>
                  <textarea value={promptSnapshot.base_prompt} rows={12} readOnly />
                  <small>{t("aiConfig.basePromptHint")}</small>
                </label>

                <label className="field">
                  <span>{t("aiConfig.effectivePrompt")}</span>
                  <textarea value={promptSnapshot.effective_prompt} rows={12} readOnly />
                  <small>{t("aiConfig.effectivePromptHint")}</small>
                </label>
              </div>
            ) : null}

            <label className="field">
              <span>{t("aiConfig.disabledMessage")}</span>
              <textarea
                value={draft.disabled_message}
                onChange={(event) => update("disabled_message", event.target.value)}
                rows={3}
                disabled={!canEdit}
              />
              <small>{t("aiConfig.disabledMessageHint")}</small>
            </label>
          </div>
        </article>
      </section>

      <TestPromptPanel disabled={isLoading} />
    </div>
  );
}

function TestPromptPanel({ disabled }: { disabled: boolean }) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState("我刚来纽约上班，住哪比较好？");
  const [language, setLanguage] = useState<"en" | "zh">("zh");
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function run() {
    setIsRunning(true);
    setResult(null);
    setErrorMessage(null);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      setErrorMessage("Supabase env not configured.");
      setIsRunning(false);
      return;
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? supabaseKey;

      const response = await fetch(`${supabaseUrl}/functions/v1/ai-search`, {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: prompt,
          conversation_language: language,
          current_filters: {},
          history: [],
        }),
      });

      const text = await response.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // leave as raw text
      }

      if (!response.ok) {
        setErrorMessage(`HTTP ${response.status}`);
      }
      setResult(pretty);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <section className="analytics-card ai-config-card" style={{ marginTop: 22 }}>
      <div className="card-heading">
        <div>
          <div className="eyebrow">{t("aiConfig.testPanel")}</div>
          <h3>{t("aiConfig.testPanelTitle")}</h3>
        </div>
        <PlayCircle size={18} />
      </div>
      <div className="ai-card-body">
        <label className="field">
          <span>{t("aiConfig.testPrompt")}</span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={3}
            disabled={disabled || isRunning}
          />
        </label>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>{t("aiConfig.testLanguage")}</span>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as "en" | "zh")}
              disabled={disabled || isRunning}
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>

          <button
            className="button dark-button"
            type="button"
            onClick={run}
            disabled={disabled || isRunning || !prompt.trim()}
            style={{ marginLeft: "auto" }}
          >
            <PlayCircle size={16} />
            {isRunning ? t("aiConfig.running") : t("aiConfig.runTest")}
          </button>
        </div>

        {errorMessage ? <div className="message compact-message error" style={{ marginTop: 12 }}>{errorMessage}</div> : null}

        {result ? (
          <pre
            style={{
              marginTop: 14,
              padding: 14,
              background: "#0f172a",
              color: "#e2e8f0",
              borderRadius: 12,
              fontSize: 12.5,
              lineHeight: 1.55,
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word"
            }}
          >
            {result}
          </pre>
        ) : null}
      </div>
    </section>
  );
}
