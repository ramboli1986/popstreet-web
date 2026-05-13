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
      activeBuildings: "Active buildings",
      liveInventory: "live inventory",
      activeDeals: "Active deals",
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
      buildingsSubtitle: "{active} active · {archived} archived · {available} available units",
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
      eyebrow: "AI Configuration",
      title: "Tune PopStreet AI",
      subtitle: "Control the assistant behavior, ranking logic, and app surfaces before wiring it to production AI services.",
      save: "Save config",
      reset: "Reset defaults",
      saved: "AI configuration saved locally.",
      resetDone: "AI configuration reset to defaults.",
      liveStatus: "Live status",
      localDraft: "Local draft",
      notConnected: "Not connected to a production model yet",
      providerModel: "Provider & model",
      provider: "Provider",
      model: "Model",
      responseLanguage: "Response language",
      responseAuto: "Follow user",
      responseEnglish: "English",
      responseChinese: "Chinese",
      tone: "Tone",
      toneConcise: "Concise advisor",
      toneFriendly: "Friendly leasing expert",
      toneSales: "Deal-focused closer",
      creativity: "Creativity",
      rankingWeights: "Ranking weights",
      budgetFit: "Budget fit",
      cashback: "Cashback",
      commute: "Commute",
      amenities: "Amenities",
      appSurfaces: "App surfaces",
      aiSearch: "AI search",
      aiSearchDesc: "Let renters describe needs and translate them into filters.",
      dealSummary: "Deal summaries",
      dealSummaryDesc: "Generate short unit insights on listing cards and detail pages.",
      tourFollowup: "Tour follow-up",
      tourFollowupDesc: "Draft message suggestions after scheduled tours.",
      adminCopilot: "Admin copilot",
      adminCopilotDesc: "Assist admins with inventory cleanup and publishing workflows.",
      prompts: "Prompts & guardrails",
      defaultPrompt: "Default renter prompt",
      guardrails: "Guardrails",
      preview: "Preview",
      previewTitle: "Example renter answer",
      previewBody:
        "I would prioritize listings that match budget first, then highlight cashback and commute trade-offs in plain language.",
      defaultPromptValue:
        "Help renters find apartments that fit budget, move-in timing, commute, lifestyle needs, and available concessions.",
      guardrailsValue:
        "Be transparent about prices and availability. Do not guarantee inventory. Ask clarifying questions when the request is ambiguous."
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
      activeBuildings: "启用大楼",
      liveInventory: "实时库存",
      activeDeals: "可租优惠",
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
      buildingsSubtitle: "{active} 启用 · {archived} 归档 · {available} 个可租房源",
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
      eyebrow: "AI 配置",
      title: "调整 PopStreet AI",
      subtitle: "配置助手行为、排序权重和 App 内 AI 功能入口，为之后接入正式 AI 服务做准备。",
      save: "保存配置",
      reset: "恢复默认",
      saved: "AI 配置已保存到本地。",
      resetDone: "AI 配置已恢复默认。",
      liveStatus: "运行状态",
      localDraft: "本地草稿",
      notConnected: "尚未连接正式模型服务",
      providerModel: "服务商与模型",
      provider: "服务商",
      model: "模型",
      responseLanguage: "回复语言",
      responseAuto: "跟随用户",
      responseEnglish: "英文",
      responseChinese: "中文",
      tone: "语气",
      toneConcise: "简洁顾问",
      toneFriendly: "友好租房专家",
      toneSales: "优惠导向",
      creativity: "创造性",
      rankingWeights: "排序权重",
      budgetFit: "预算匹配",
      cashback: "返现力度",
      commute: "通勤",
      amenities: "设施",
      appSurfaces: "功能入口",
      aiSearch: "AI 搜索",
      aiSearchDesc: "让用户用自然语言描述需求，并转换成筛选条件。",
      dealSummary: "优惠总结",
      dealSummaryDesc: "为列表卡片和详情页生成简短推荐理由。",
      tourFollowup: "看房跟进",
      tourFollowupDesc: "在预约看房后生成消息建议。",
      adminCopilot: "后台助手",
      adminCopilotDesc: "辅助管理员整理库存、发布和下架房源。",
      prompts: "Prompt 与安全边界",
      defaultPrompt: "默认租客 Prompt",
      guardrails: "安全边界",
      preview: "预览",
      previewTitle: "示例回复",
      previewBody: "我会先按预算匹配排序，再用简单清楚的话说明返现和通勤之间的取舍。",
      defaultPromptValue: "帮助租客根据预算、入住时间、通勤、生活方式和当前优惠找到合适公寓。",
      guardrailsValue: "如实说明价格和可租状态。不要保证库存一定存在。需求不明确时先追问。"
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
