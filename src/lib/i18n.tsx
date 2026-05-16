"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Language = "en" | "zh";

type TranslationValue = string | { [key: string]: TranslationValue };
type TranslationDictionary = Record<string, TranslationValue>;
type TranslationParams = Record<string, number | string>;

const storageKey = "popstreet.admin.language";

const dictionaries: Record<Language, TranslationDictionary> = {
  en: {
    views: {
      dashboard: "Overview",
      building: "Buildings",
      companies: "Companies",
      units: "Units & Deals",
      map: "Map",
      accounts: "Accounts",
      aiConfig: "AI Config"
    },
    nav: {
      dashboard: "Dashboard",
      building: "Buildings",
      companies: "Companies",
      units: "Units & Deals",
      map: "Map",
      accounts: "Accounts",
      aiConfig: "AI Config"
    },
    shell: {
      adminConsole: "Admin Console",
      workspace: "Workspace",
      dataSourcesHealthy: "Data sources healthy",
      supabaseLive: "Supabase live",
      globalSearch: "Search buildings, units, companies...",
      env: "prod",
      noRole: "No role",
      signedIn: "Signed in",
      signOut: "Sign out",
      loading: "Loading PopStreet Admin...",
      viewerAccess:
        "You currently have viewer access. If this is the first admin account, claim super admin below. Otherwise ask an admin to upgrade your role.",
      claimFirstAdmin: "Claim first admin",
      firstAdminClaimed: "This account is now the first super admin.",
      restoreSessionFailed: "Could not restore the saved session.",
      language: "Language",
      english: "EN",
      chinese: "中文"
    },
    auth: {
      product: "PopStreet Admin",
      console: "Building console",
      welcome: "Welcome back.",
      createAccount: "Create an admin account.",
      subtitle: "Manage buildings, units, listings, map coordinates, and account access from one place.",
      fullName: "Full name",
      email: "Email",
      password: "Password",
      working: "Working...",
      login: "Log in",
      create: "Create account",
      needAccount: "Need an account?",
      alreadyHaveAccess: "Already have access?",
      register: "Register",
      signupMessage: "Account created. Check your email if confirmation is enabled in Supabase."
    },
    roles: {
      super_admin: "Super admin",
      admin: "Admin",
      editor: "Editor",
      viewer: "Viewer"
    },
    statuses: {
      active: "Active",
      pending: "Pending",
      suspended: "Suspended"
    },
    common: {
      active: "Active",
      archived: "Archived",
      available: "Available",
      back: "back",
      buildings: "buildings",
      disabled: "Disabled",
      edit: "Edit",
      enabled: "Enabled",
      loading: "Loading...",
      market: "market",
      na: "N/A",
      refresh: "Refresh",
      reset: "Reset",
      save: "Save",
      saving: "Saving...",
      total: "total",
      unavailable: "Unavailable",
      unit: "Unit",
      units: "units"
    },
    dashboard: {
      eyebrow: "Overview",
      title: "Today's market pulse",
      subtitle: "{buildings} buildings tracked · {listings} available listings in the latest sync",
      today: "Today",
      sevenDays: "7d",
      thirtyDays: "30d",
      activeBuildings: "Buildings with availability",
      liveInventory: "with available units",
      activeDeals: "Available units",
      availableNow: "available now",
      newToday: "New today",
      freshListings: "fresh listings",
      offMarketToday: "Off-market today",
      removedToday: "removed today",
      medianNetRent: "Median net rent",
      currentAvailable: "current available",
      dailyActivity: "Daily activity",
      newVsUnavailable: "New listings vs went unavailable",
      new: "New",
      hot: "Hot",
      topDealsNow: "Top deals right now",
      live: "Live",
      areaInventory: "Area inventory",
      unitsByArea: "Available units by area",
      availableAreas: "{count} areas",
      availableUnitCount: "{count} available",
      areaUnitCount: "{units} units · {buildings} buildings",
      availableUnitsTotal: "available units tracked",
      noAreaUnits: "No available units",
      noAreaUnitsHint: "Area stats will appear after available listings are synced.",
      recentlyUpdated: "Recently updated",
      latest: "{count} latest",
      neighborhoodMix: "Neighborhood mix",
      dealConcentration: "Deal concentration",
      topDeals: "Top deals",
      dealCount: "{count} deals",
      unknownBuilding: "Unknown building",
      noLocation: "No location",
      layoutMissing: "Layout missing",
      studio: "Studio",
      bedShort: "bd",
      bathShort: "ba",
      sqft: "sqft",
      noMarketPrice: "No market price",
      monthsFreeShort: "{count} mo free",
      percentOff: "{percent}% off"
    },
    manager: {
      buildingsEyebrow: "Buildings",
      buildingsTitle: "Inventory · {count} properties",
      buildingsSubtitle: "{companies} companies · {available} available units",
      unitsEyebrow: "Daily deals",
      unitsTitle: "Units & Deals",
      unitsSubtitle: "{total} matching units · {available} available right now",
      mapEyebrow: "Geo & coordinates",
      mapTitle: "Map editor",
      mapSubtitle: "View buildings on one light map. Pin colors are grouped by area and selected pins can be edited.",
      geolocated: "{visible} of {total} buildings geolocated",
      resetMapView: "Reset map view",
      areas: "Areas:",
      allAreas: "All Areas",
      newBuilding: "New building",
      viewerReadOnly: "Viewer role is read-only.",
      searchUnit: "Search unit, building, address...",
      searchBuilding: "Search name, address, area...",
      allBuildings: "All buildings",
      allCompanies: "All companies",
      allStatus: "All status",
      allLayouts: "All layouts",
      allLocations: "All locations",
      activeOnly: "Active only",
      archivedOnly: "Archived only",
      addUnit: "Add unit",
      buildingList: "Building list",
      fastQueryEdit: "Fast query and edit",
      availableUnits: "available units",
      matchingUnits: "matching units"
    },
    companies: {
      eyebrow: "Management companies",
      title: "Company list · {count} records",
      subtitle: "Search, edit, add, and remove management companies. Buildings can link to one company record for cleaner data.",
      add: "Add company",
      search: "Search company, website, assets...",
      companies: "companies",
      linkedBuildings: "linked buildings",
      list: "Company list",
      empty: "No management companies found.",
      noCompanies: "No companies",
      showing: "Showing {from}-{to} of {total} companies",
      previous: "Previous",
      next: "Next",
      company: "Company",
      website: "Website",
      keyAssets: "Key assets",
      updated: "Updated",
      actions: "Actions",
      more: "+{count} more",
      created: "Management company created.",
      saved: "Management company saved.",
      deleted: "Management company deleted."
    },
    accounts: {
      eyebrow: "Access control",
      title: "Accounts and roles",
      roleMatrix: "Role matrix",
      leastPrivilege: "Assign least-privilege access",
      accounts: "accounts",
      role: "Role",
      status: "Status",
      updated: "Account access updated."
    },
    aiConfig: {
      eyebrow: "AI Search Runtime",
      title: "Tune PopStreet AI search",
      subtitle: "Live config for the ai-search Edge Function. Changes take effect within ~30 seconds.",
      save: "Save",
      saving: "Saving…",
      revert: "Revert",
      saved: "Saved. Changes propagate to the Edge Function within ~30s.",
      noPermission: "You do not have permission to change AI settings.",
      viewerOnly: "Read-only — only super_admin or admin can change AI settings.",
      tokensRange: "Max output tokens must be between 100 and 4000.",
      liveStatus: "Live status",
      statusOn: "On",
      statusOff: "Off",
      lastUpdated: "Last updated",
      runtime: "Runtime",
      enableLabel: "Enable AI search",
      enableDesc: "When off, iOS receives a polite fallback and falls back to manual filters.",
      model: "Model",
      modelHint: "OpenAI model ID. Defaults to gpt-5.4-mini.",
      maxOutputTokens: "Max output tokens",
      maxOutputTokensHint: "Typical responses are 200-400. 500 is a safe ceiling.",
      responseLanguageOverride: "Response language override",
      responseLanguageHint: "Leave on \"Follow user\" to honor iOS-detected language.",
      prompts: "Prompt addendum",
      addendum: "System prompt addendum",
      addendumPlaceholder: "Extra rules appended to the broker prompt, e.g. \"Always mention if a building has a referral bonus.\"",
      addendumHint: "Editable live context. It is appended to the deployed base prompt and takes effect without app changes.",
      promptSource: "Live prompt source",
      promptSourceHint: "Sync from the deployed Edge Function to view the current base prompt.",
      syncPrompt: "Sync live prompt",
      syncingPrompt: "Syncing…",
      promptSynced: "Prompt synced from the deployed Edge Function.",
      promptCopied: "Prompt copied.",
      copyFailed: "Could not copy prompt.",
      insertMarketNotes: "Insert market notes",
      copyEffectivePrompt: "Copy effective prompt",
      promptVersion: "Prompt version",
      liveModel: "Live model",
      effectivePromptLength: "Effective prompt length",
      basePrompt: "Deployed base prompt",
      basePromptHint: "Read-only. This lives in supabase/functions/ai-search/index.ts inside systemPrompt().",
      effectivePrompt: "Effective prompt preview",
      effectivePromptHint: "Base prompt plus the current addendum exactly as the Edge Function sends it to OpenAI.",
      disabledMessage: "Disabled message",
      disabledMessageHint: "Shown to users when AI search is turned off.",
      testPanel: "Test",
      testPanelTitle: "Test prompt",
      testPrompt: "Prompt",
      testLanguage: "Language",
      runTest: "Run test",
      running: "Running…"
    }
  },
  zh: {
    views: {
      dashboard: "总览",
      building: "大楼",
      companies: "公司",
      units: "房源与优惠",
      map: "地图",
      accounts: "账号",
      aiConfig: "AI 配置"
    },
    nav: {
      dashboard: "总览",
      building: "大楼",
      companies: "公司",
      units: "房源与优惠",
      map: "地图",
      accounts: "账号",
      aiConfig: "AI 配置"
    },
    shell: {
      adminConsole: "后台管理",
      workspace: "工作台",
      dataSourcesHealthy: "数据源正常",
      supabaseLive: "Supabase 已连接",
      globalSearch: "搜索大楼、房源、公司...",
      env: "生产",
      noRole: "暂无角色",
      signedIn: "已登录",
      signOut: "退出登录",
      loading: "正在加载 PopStreet 后台...",
      viewerAccess: "当前账号是只读权限。如果这是第一个管理员账号，可以在下方领取超级管理员；否则请联系管理员升级权限。",
      claimFirstAdmin: "领取首个管理员",
      firstAdminClaimed: "当前账号已成为首个超级管理员。",
      restoreSessionFailed: "无法恢复已保存的登录状态。",
      language: "语言",
      english: "EN",
      chinese: "中文"
    },
    auth: {
      product: "PopStreet 后台",
      console: "大楼管理台",
      welcome: "欢迎回来。",
      createAccount: "创建管理员账号。",
      subtitle: "在一个地方管理大楼、房源、价格、地图坐标和账号权限。",
      fullName: "姓名",
      email: "邮箱",
      password: "密码",
      working: "处理中...",
      login: "登录",
      create: "创建账号",
      needAccount: "还没有账号？",
      alreadyHaveAccess: "已有权限？",
      register: "注册",
      signupMessage: "账号已创建。如果 Supabase 开启了邮箱确认，请检查邮件。"
    },
    roles: {
      super_admin: "超级管理员",
      admin: "管理员",
      editor: "编辑",
      viewer: "只读"
    },
    statuses: {
      active: "启用",
      pending: "待确认",
      suspended: "停用"
    },
    common: {
      active: "启用",
      archived: "归档",
      available: "可租",
      back: "返现",
      buildings: "大楼",
      disabled: "关闭",
      edit: "编辑",
      enabled: "开启",
      loading: "加载中...",
      market: "原价",
      na: "暂无",
      refresh: "刷新",
      reset: "重置",
      save: "保存",
      saving: "保存中...",
      total: "总计",
      unavailable: "不可租",
      unit: "房源",
      units: "房源"
    },
    dashboard: {
      eyebrow: "总览",
      title: "今日房源市场概览",
      subtitle: "已追踪 {buildings} 栋大楼 · 最近同步有 {listings} 个可租房源",
      today: "今日",
      sevenDays: "7 天",
      thirtyDays: "30 天",
      activeBuildings: "有可租房源的大楼",
      liveInventory: "有可租房源",
      activeDeals: "可租房源",
      availableNow: "当前可租",
      newToday: "今日新增",
      freshListings: "新上架房源",
      offMarketToday: "今日下架",
      removedToday: "已下架房源",
      medianNetRent: "净租金中位数",
      currentAvailable: "当前可租",
      dailyActivity: "每日动态",
      newVsUnavailable: "新增房源 vs 下架房源",
      new: "新增",
      hot: "热门",
      topDealsNow: "当前优质优惠",
      live: "实时",
      areaInventory: "区域库存",
      unitsByArea: "各区域可租房源统计",
      availableAreas: "{count} 个区域",
      availableUnitCount: "{count} 个可租",
      areaUnitCount: "{units} 个房源 · {buildings} 栋大楼",
      availableUnitsTotal: "个可租房源已统计",
      noAreaUnits: "暂无可租房源",
      noAreaUnitsHint: "同步到可租 listing 后会显示区域统计。",
      recentlyUpdated: "最近更新",
      latest: "最新 {count} 条",
      neighborhoodMix: "区域分布",
      dealConcentration: "优惠集中度",
      topDeals: "优质优惠",
      dealCount: "{count} 个优惠",
      unknownBuilding: "未知大楼",
      noLocation: "暂无位置",
      layoutMissing: "暂无户型",
      studio: "Studio",
      bedShort: "房",
      bathShort: "卫",
      sqft: "平方英尺",
      noMarketPrice: "暂无原价",
      monthsFreeShort: "{count} 个月免费",
      percentOff: "{percent}% 折扣"
    },
    manager: {
      buildingsEyebrow: "大楼",
      buildingsTitle: "库存 · {count} 栋大楼",
      buildingsSubtitle: "{companies} 家公司 · {available} 个可租房源",
      unitsEyebrow: "每日优惠",
      unitsTitle: "房源与优惠",
      unitsSubtitle: "{total} 个匹配房源 · {available} 个当前可租",
      mapEyebrow: "地图与坐标",
      mapTitle: "地图编辑",
      mapSubtitle: "在浅色地图上查看大楼。Pin 颜色按区域分组，选中后可编辑坐标与信息。",
      geolocated: "已定位 {visible} / {total} 栋大楼",
      resetMapView: "重置地图视图",
      areas: "区域：",
      allAreas: "全部区域",
      newBuilding: "新增大楼",
      viewerReadOnly: "只读角色无法编辑。",
      searchUnit: "搜索房源、大楼、地址...",
      searchBuilding: "搜索名称、地址、区域...",
      allBuildings: "全部大楼",
      allCompanies: "全部公司",
      allStatus: "全部状态",
      allLayouts: "全部户型",
      allLocations: "全部位置",
      activeOnly: "仅启用",
      archivedOnly: "仅归档",
      addUnit: "新增房源",
      buildingList: "大楼列表",
      fastQueryEdit: "快速查询与编辑",
      availableUnits: "可租房源",
      matchingUnits: "匹配房源"
    },
    companies: {
      eyebrow: "管理公司",
      title: "公司列表 · {count} 条记录",
      subtitle: "快速搜索、编辑、新增和删除管理公司。大楼可以关联到统一公司记录，方便保持数据干净。",
      add: "新增公司",
      search: "搜索公司、网站、资产...",
      companies: "公司",
      linkedBuildings: "已关联大楼",
      list: "公司列表",
      empty: "没有找到管理公司。",
      noCompanies: "暂无公司",
      showing: "显示 {from}-{to}，共 {total} 家公司",
      previous: "上一页",
      next: "下一页",
      company: "公司",
      website: "网站",
      keyAssets: "主要资产",
      updated: "更新",
      actions: "操作",
      more: "另有 {count} 个",
      created: "管理公司已创建。",
      saved: "管理公司已保存。",
      deleted: "管理公司已删除。"
    },
    accounts: {
      eyebrow: "权限管理",
      title: "账号与角色",
      roleMatrix: "角色矩阵",
      leastPrivilege: "分配最小必要权限",
      accounts: "个账号",
      role: "角色",
      status: "状态",
      updated: "账号权限已更新。"
    },
    aiConfig: {
      eyebrow: "AI 搜索运行时配置",
      title: "调整 PopStreet AI 搜索",
      subtitle: "Edge Function 的实时配置。修改约 30 秒内生效。",
      save: "保存",
      saving: "保存中…",
      revert: "撤销",
      saved: "已保存。约 30 秒内生效。",
      noPermission: "你没有权限修改 AI 设置。",
      viewerOnly: "只读模式 —— 只有 super_admin 或 admin 才能修改 AI 设置。",
      tokensRange: "Max output tokens 必须在 100 到 4000 之间。",
      liveStatus: "运行状态",
      statusOn: "开启",
      statusOff: "关闭",
      lastUpdated: "上次更新",
      runtime: "运行参数",
      enableLabel: "启用 AI 搜索",
      enableDesc: "关闭后 iOS 会收到一段提示，回退到手动筛选。",
      model: "模型",
      modelHint: "OpenAI 模型 ID，默认 gpt-5.4-mini。",
      maxOutputTokens: "最大输出 tokens",
      maxOutputTokensHint: "典型回复 200-400，500 是个稳妥的上限。",
      responseLanguageOverride: "强制回复语言",
      responseLanguageHint: "选择 \"跟随用户\" 时使用 iOS 识别的语言。",
      prompts: "Prompt 附加内容",
      addendum: "System prompt 附加",
      addendumPlaceholder: "追加到 broker prompt 的额外规则，例如 \"如果某栋楼有推荐返现，请主动告知\"。",
      addendumHint: "可实时编辑的上下文。会追加到线上基础 prompt，不需要发版。",
      promptSource: "线上 prompt 来源",
      promptSourceHint: "从已部署的 Edge Function 同步，查看当前基础 prompt。",
      syncPrompt: "同步线上 prompt",
      syncingPrompt: "同步中…",
      promptSynced: "已从线上 Edge Function 同步 prompt。",
      promptCopied: "Prompt 已复制。",
      copyFailed: "无法复制 prompt。",
      insertMarketNotes: "插入区域知识模板",
      copyEffectivePrompt: "复制最终 prompt",
      promptVersion: "Prompt 版本",
      liveModel: "线上模型",
      effectivePromptLength: "最终 prompt 长度",
      basePrompt: "已部署基础 prompt",
      basePromptHint: "只读。内容来自 supabase/functions/ai-search/index.ts 的 systemPrompt()。",
      effectivePrompt: "最终 prompt 预览",
      effectivePromptHint: "基础 prompt + 当前 addendum，也就是 Edge Function 实际发给 OpenAI 的内容。",
      disabledMessage: "关闭时提示语",
      disabledMessageHint: "当 AI 搜索关闭时返回给用户的提示文案。",
      testPanel: "测试",
      testPanelTitle: "试一句",
      testPrompt: "Prompt",
      testLanguage: "语言",
      runTest: "运行",
      running: "运行中…"
    }
  }
};

type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, params?: TranslationParams) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function resolve(dictionary: TranslationDictionary, key: string): string | undefined {
  const value = key.split(".").reduce<TranslationValue | undefined>((current, part) => {
    if (!current || typeof current === "string") {
      return undefined;
    }

    return current[part];
  }, dictionary);

  return typeof value === "string" ? value : undefined;
}

function interpolate(template: string, params?: TranslationParams) {
  if (!params) {
    return template;
  }

  return Object.entries(params).reduce(
    (current, [key, value]) => current.replaceAll(`{${key}}`, String(value)),
    template
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");

  const setLanguage = useCallback((nextLanguage: Language) => {
    setLanguageState(nextLanguage);
    window.localStorage.setItem(storageKey, nextLanguage);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);

  useEffect(() => {
    const savedLanguage = window.localStorage.getItem(storageKey);
    if (savedLanguage === "zh" || savedLanguage === "en") {
      setLanguageState(savedLanguage);
    }
  }, []);

  const t = useCallback(
    (key: string, params?: TranslationParams) => {
      const template = resolve(dictionaries[language], key) ?? resolve(dictionaries.en, key) ?? key;
      return interpolate(template, params);
    },
    [language]
  );

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error("useI18n must be used within I18nProvider.");
  }

  return context;
}
