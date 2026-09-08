export type AvailabilityCrawlerAutomationSummaryInput = {
  automation_enabled: boolean;
  auto_publish_enabled: boolean;
  market: string;
  schedule_label: string;
  schedule_timezone: string;
};

export type AvailabilityCrawlerAutomationUpdateInput = {
  automationEnabled?: boolean;
  autoPublishEnabled?: boolean;
};

export function buildAvailabilityCrawlerAutomationUpdate({
  automationEnabled,
  autoPublishEnabled,
}: AvailabilityCrawlerAutomationUpdateInput) {
  return {
    p_automation_enabled: automationEnabled ?? null,
    p_auto_publish_enabled: automationEnabled === false ? false : autoPublishEnabled ?? null,
  };
}

export function describeAvailabilityCrawlerAutomation(settings: AvailabilityCrawlerAutomationSummaryInput) {
  if (!settings.automation_enabled) {
    return {
      body: "Scheduled runs are stopped. Use Run crawl when you are ready, then preview and publish manually.",
      manualControlsAvailable: true,
      modeLabel: "Manual",
      title: "Automatic crawling is paused",
    };
  }

  const publishCopy = settings.auto_publish_enabled
    ? "The system publishes automatically when a completed run passes safety checks."
    : "The system waits for manual review and publish after each completed run.";
  return {
    body: `${settings.schedule_label} (${settings.schedule_timezone}) for ${settings.market}. ${publishCopy}`,
    manualControlsAvailable: true,
    modeLabel: "Automatic",
    title: "Automatic crawling is active",
  };
}
