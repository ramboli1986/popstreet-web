"use client";

import { useCallback, useEffect, useState } from "react";
import { Clipboard, FileText, PlayCircle, RefreshCw, RotateCcw, Save, Sparkles } from "lucide-react";
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
  destination_prompt_override: string | null;
  disabled_message: string;
  updated_at: string;
  updated_by: string | null;
};

const defaultConfig: AISearchConfig = {
  id: CONFIG_ID,
  enabled: true,
  model: "gpt-5.4-mini",
  max_output_tokens: 900,
  response_language_override: null,
  system_prompt_addendum: "",
  destination_prompt_override: null,
  disabled_message: "AI search is temporarily off. Please use the manual filters in Explore.",
  updated_at: new Date().toISOString(),
  updated_by: null,
};

type PromptSnapshot = {
  prompt_version: string;
  prompt_source: string;
  base_prompt: string;
  system_prompt_addendum: string;
  destination_prompt_override: string | null;
  effective_prompt: string;
  model: string;
  max_output_tokens: number;
  response_language_override: string | null;
  enabled: boolean;
};

type AIConfigPageProps = {
  profile: AccountProfile | null;
};

function normalizeConfig(value: Partial<AISearchConfig> | null): AISearchConfig {
  return {
    ...defaultConfig,
    ...(value ?? {}),
    destination_prompt_override: value?.destination_prompt_override ?? null,
    system_prompt_addendum: value?.system_prompt_addendum ?? "",
    response_language_override: value?.response_language_override ?? null,
  };
}

export function AIConfigPage({ profile }: AIConfigPageProps = { profile: null }) {
  const { t } = useI18n();
  const [config, setConfig] = useState<AISearchConfig>(defaultConfig);
  const [promptSnapshot, setPromptSnapshot] = useState<PromptSnapshot | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [testQuery, setTestQuery] = useState("meta");
  const [destinationKind, setDestinationKind] = useState<"work" | "school">("work");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncingPrompt, setIsSyncingPrompt] = useState(false);
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canEdit = canManageAccounts(profile?.role, profile?.account_kind, profile?.status);
  const backendPrompt = promptSnapshot?.effective_prompt ?? config.destination_prompt_override ?? "";
  const isPromptDirty = promptDraft.trim() !== backendPrompt.trim();

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

    const next = normalizeConfig(data as Partial<AISearchConfig> | null);
    setConfig(next);
    setPromptDraft((current) => current.trim() ? current : next.destination_prompt_override ?? "");
    setIsLoading(false);
  }, []);

  const syncPromptSnapshot = useCallback(
    async (announce = true) => {
      setIsSyncingPrompt(true);
      setErrorMessage(null);
      if (announce) {
        setMessage(null);
      }

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
        setPromptDraft(snapshot.effective_prompt);
        setConfig((prev) => ({
          ...prev,
          enabled: snapshot.enabled,
          model: snapshot.model,
          max_output_tokens: snapshot.max_output_tokens,
          response_language_override: snapshot.response_language_override,
          system_prompt_addendum: snapshot.system_prompt_addendum,
          destination_prompt_override: snapshot.destination_prompt_override,
        }));
        if (announce) {
          setMessage(t("aiConfig.promptSynced"));
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Could not sync prompt.");
      } finally {
        setIsSyncingPrompt(false);
      }
    },
    [t]
  );

  useEffect(() => {
    loadConfig();
    syncPromptSnapshot(false);
  }, [loadConfig, syncPromptSnapshot]);

  async function copyPromptToClipboard() {
    try {
      await navigator.clipboard.writeText(promptDraft);
      setMessage(t("aiConfig.promptCopied"));
      setErrorMessage(null);
    } catch {
      setErrorMessage(t("aiConfig.copyFailed"));
    }
  }

  function resetPromptDraft() {
    setPromptDraft(backendPrompt);
    setMessage(null);
    setErrorMessage(null);
  }

  async function savePromptOverride() {
    if (!canEdit) {
      setErrorMessage(t("aiConfig.noPermission"));
      return;
    }

    const nextPrompt = promptDraft.trim();
    if (!nextPrompt) {
      setErrorMessage(t("aiConfig.promptRequired"));
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setMessage(null);

    const payload = {
      ...config,
      id: CONFIG_ID,
      system_prompt_addendum: "",
      destination_prompt_override: nextPrompt,
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

    const next = normalizeConfig(data as Partial<AISearchConfig>);
    setConfig(next);
    setPromptSnapshot((prev) =>
      prev
        ? {
            ...prev,
            system_prompt_addendum: "",
            destination_prompt_override: nextPrompt,
            effective_prompt: nextPrompt,
          }
        : prev
    );
    setMessage(t("aiConfig.saved"));
  }

  async function runTest() {
    const activePrompt = promptDraft.trim();
    const query = testQuery.trim();
    if (!activePrompt) {
      setErrorMessage(t("aiConfig.promptRequired"));
      return;
    }
    if (!query) {
      setErrorMessage(t("aiConfig.testQueryRequired"));
      return;
    }

    setIsRunningTest(true);
    setTestResult(null);
    setErrorMessage(null);
    setMessage(null);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      setErrorMessage("Supabase env not configured.");
      setIsRunningTest(false);
      return;
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        setErrorMessage("Admin session is required to test this prompt.");
        return;
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/ai-search`, {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "resolve_destination",
          query,
          destination_kind: destinationKind,
          prompt_override: activePrompt,
        }),
      });

      const text = await response.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Keep raw text when the function returns non-JSON.
      }

      if (!response.ok) {
        setErrorMessage(`HTTP ${response.status}`);
      }
      setTestResult(pretty);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsRunningTest(false);
    }
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
          <button className="ghost-button" onClick={() => syncPromptSnapshot()} type="button" disabled={isSyncingPrompt}>
            <RefreshCw size={16} />
            {isSyncingPrompt ? t("aiConfig.syncingPrompt") : t("aiConfig.syncPrompt")}
          </button>
          <button className="ghost-button" onClick={resetPromptDraft} type="button" disabled={!isPromptDirty || isSaving}>
            <RotateCcw size={16} />
            {t("aiConfig.revert")}
          </button>
          <button
            className="button dark-button"
            onClick={savePromptOverride}
            type="button"
            disabled={!isPromptDirty || isSaving || !canEdit || !promptDraft.trim()}
          >
            <Save size={16} />
            {isSaving ? t("aiConfig.saving") : t("aiConfig.syncToBackend")}
          </button>
        </div>
      </div>

      {!canEdit ? <div className="message compact-message">{t("aiConfig.viewerOnly")}</div> : null}
      {message ? <div className="message compact-message">{message}</div> : null}
      {errorMessage ? <div className="message compact-message error">{errorMessage}</div> : null}

      <article className="analytics-card ai-config-card ai-prompt-card">
        <div className="card-heading">
          <div>
            <div className="eyebrow">{t("aiConfig.prompts")}</div>
            <h3>{t("aiConfig.promptEditor")}</h3>
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
              <button className="ghost-button" onClick={copyPromptToClipboard} type="button" disabled={!promptDraft.trim()}>
                <Clipboard size={15} />
                {t("aiConfig.copyEffectivePrompt")}
              </button>
            </div>
          </div>

          <div className="ai-prompt-meta-grid">
            <div>
              <span>{t("aiConfig.liveModel")}</span>
              <strong>{promptSnapshot?.model ?? config.model}</strong>
            </div>
            <div>
              <span>{t("aiConfig.effectivePromptLength")}</span>
              <strong>{promptDraft.length.toLocaleString()} chars</strong>
            </div>
            <div>
              <span>{t("aiConfig.lastUpdated")}</span>
              <strong>{new Date(config.updated_at).toLocaleString()}</strong>
            </div>
          </div>

          <label className="field">
            <span>{t("aiConfig.promptEditor")}</span>
            <textarea
              value={promptDraft}
              onChange={(event) => setPromptDraft(event.target.value)}
              placeholder={t("aiConfig.promptEditorPlaceholder")}
              rows={22}
              disabled={!canEdit || isLoading}
            />
            <small>{t("aiConfig.promptEditorHint")}</small>
          </label>

          <div style={{ borderTop: "1px solid #e5e7eb", marginTop: 20, paddingTop: 20 }}>
            <div className="card-heading" style={{ marginBottom: 14 }}>
              <div>
                <div className="eyebrow">{t("aiConfig.testPanel")}</div>
                <h3>{t("aiConfig.testPanelTitle")}</h3>
              </div>
              <PlayCircle size={18} />
            </div>

            <label className="field">
              <span>{t("aiConfig.testPrompt")}</span>
              <input
                value={testQuery}
                onChange={(event) => setTestQuery(event.target.value)}
                placeholder="meta, jpmorgan, nyu..."
                disabled={isRunningTest}
              />
            </label>

            <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginTop: 8 }}>
              <label className="field" style={{ marginBottom: 0, maxWidth: 220 }}>
                <span>{t("aiConfig.testLanguage")}</span>
                <select
                  value={destinationKind}
                  onChange={(event) => setDestinationKind(event.target.value as "work" | "school")}
                  disabled={isRunningTest}
                >
                  <option value="work">Work</option>
                  <option value="school">School</option>
                </select>
              </label>

              <button
                className="button dark-button"
                type="button"
                onClick={runTest}
                disabled={isRunningTest || !testQuery.trim() || !promptDraft.trim()}
                style={{ marginLeft: "auto" }}
              >
                <Sparkles size={16} />
                {isRunningTest ? t("aiConfig.running") : t("aiConfig.runTest")}
              </button>
            </div>

            {testResult ? (
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
                  wordBreak: "break-word",
                }}
              >
                {testResult}
              </pre>
            ) : null}
          </div>
        </div>
      </article>
    </div>
  );
}
