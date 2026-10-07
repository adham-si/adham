import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export const defaultResources = {
  en: {
    translation: {
      appName: 'Adham',
      tagline: 'The only AI application you need',
      welcome: 'What would you like to work on?',
      workspace: 'Workspace',
      project: 'Project',
      session: 'Session',
      compose: {
        placeholder: 'Type a message or instruction...',
        send: 'Send',
        agent: 'Manager Agent',
        model: 'Auto route',
        privacy: 'Local',
        modes: {
          ask: 'Ask',
          plan: 'Plan',
          execute: 'Execute',
          code: 'Code',
        },
      },
      status: {
        ready: 'Ready',
        loading: 'Loading...',
        error: 'An error occurred',
      },
      rail: {
        compose: 'Compose',
        search: 'Search',
        projects: 'Projects',
        agents: 'Agents',
        activity: 'Activity',
        marketplace: 'Marketplace',
        settings: 'Settings',
        toggleSidebar: 'Toggle sidebar',
        focusMode: 'Focus mode',
        toggleTheme: 'Switch theme',
      },
      sidebar: {
        newTask: 'New task',
        recentSessions: 'Sessions',
        noSessions: 'No sessions yet',
        collapse: 'Collapse sidebar',
        expand: 'Expand sidebar',
      },
      contextPanel: {
        title: 'Inspector',
        close: 'Close panel',
        tabs: {
          plan: 'Plan',
          activity: 'Activity',
          graph: 'Task graph',
          agents: 'Agents',
          context: 'Context',
          artifacts: 'Artifacts',
        },
      },
    },
  },
  ar: {
    translation: {
      appName: 'أدهم',
      tagline: 'تطبيق الذكاء الاصطناعي الوحيد الذي تحتاجه',
      welcome: 'ما الذي ترغب في العمل عليه؟',
      workspace: 'مساحة العمل',
      project: 'المشروع',
      session: 'الجلسة',
      compose: {
        placeholder: 'اكتب رسالة أو تعليمة...',
        send: 'إرسال',
        agent: 'الوكيل المدير',
        model: 'توجيه تلقائي',
        privacy: 'محلي',
        modes: {
          ask: 'سؤال',
          plan: 'خطة',
          execute: 'تنفيذ',
          code: 'برمجة',
        },
      },
      status: {
        ready: 'جاهز',
        loading: 'جارٍ التحميل...',
        error: 'حدث خطأ',
      },
      rail: {
        compose: 'إنشاء',
        search: 'بحث',
        projects: 'المشاريع',
        agents: 'الوكلاء',
        activity: 'النشاط',
        marketplace: 'المتجر',
        settings: 'الإعدادات',
        toggleSidebar: 'تبديل الشريط الجانبي',
        focusMode: 'وضع التركيز',
        toggleTheme: 'تبديل المظهر',
      },
      sidebar: {
        newTask: 'مهمة جديدة',
        recentSessions: 'الجلسات',
        noSessions: 'لا توجد جلسات بعد',
        collapse: 'طي الشريط الجانبي',
        expand: 'توسيع الشريط الجانبي',
      },
      contextPanel: {
        title: 'لوحة المعاينة',
        close: 'إغلاق اللوحة',
        tabs: {
          plan: 'الخطة',
          activity: 'النشاط',
          graph: 'مخطط المهام',
          agents: 'الوكلاء',
          context: 'السياق',
          artifacts: 'المخرجات',
        },
      },
    },
  },
  'zh-CN': {
    translation: {
      appName: 'Adham',
      tagline: '您唯一需要的 AI 工作空间',
      welcome: '您想开始什么工作？',
      workspace: '工作区',
      project: '项目',
      session: '会话',
      compose: {
        placeholder: '输入消息或指令...',
        send: '发送',
        agent: '管理智能体',
        model: '自动路由',
        privacy: '本地',
        modes: {
          ask: '提问',
          plan: '规划',
          execute: '执行',
          code: '编写代码',
        },
      },
      status: {
        ready: '就绪',
        loading: '加载中...',
        error: '发生错误',
      },
      rail: {
        compose: '主工作台',
        search: '搜索',
        projects: '项目',
        agents: '智能体',
        activity: '动态',
        marketplace: '插件广场',
        settings: '设置',
        toggleSidebar: '切换侧边栏',
        focusMode: '专注模式',
        toggleTheme: '切换主题',
      },
      sidebar: {
        newTask: '新建任务',
        recentSessions: '历史会话',
        noSessions: '暂无会话',
        collapse: '折叠侧边栏',
        expand: '展开侧边栏',
      },
      contextPanel: {
        title: '检查面板',
        close: '关闭面板',
        tabs: {
          plan: '执行计划',
          activity: '活动日志',
          graph: '任务关系图',
          agents: '协同智能体',
          context: '环境上下文',
          artifacts: '产出物',
        },
      },
    },
  },
  ru: {
    translation: {
      appName: 'Adham',
      tagline: 'Единственное ИИ-приложение, которое вам нужно',
      welcome: 'Над чем бы вы хотели поработать?',
      workspace: 'Рабочее пространство',
      project: 'Проект',
      session: 'Сессия',
      compose: {
        placeholder: 'Введите сообщение или команду...',
        send: 'Отправить',
        agent: 'Агент-менеджер',
        model: 'Авто-маршрутизация',
        privacy: 'Локально',
        modes: {
          ask: 'Вопрос',
          plan: 'План',
          execute: 'Выполнение',
          code: 'Код',
        },
      },
      status: {
        ready: 'Готово',
        loading: 'Загрузка...',
        error: 'Произошла ошибка',
      },
      rail: {
        compose: 'Создать',
        search: 'Поиск',
        projects: 'Проекты',
        agents: 'Агенты',
        activity: 'Активность',
        marketplace: 'Каталог',
        settings: 'Настройки',
        toggleSidebar: 'Скрыть/показать панель',
        focusMode: 'Режим фокуса',
        toggleTheme: 'Переключить тему',
      },
      sidebar: {
        newTask: 'Новая задача',
        recentSessions: 'Сессии',
        noSessions: 'Нет сессий',
        collapse: 'Свернуть панель',
        expand: 'Развернуть панель',
      },
      contextPanel: {
        title: 'Инспектор',
        close: 'Закрыть панель',
        tabs: {
          plan: 'План',
          activity: 'Активность',
          graph: 'Граф задач',
          agents: 'Агенты',
          context: 'Контекст',
          artifacts: 'Артефакты',
        },
      },
    },
  },
};

// Initial language detection
const detectedLang = navigator.language.startsWith('ar') ? 'ar' : 'en';

i18n.use(initReactI18next).init({
  resources: defaultResources,
  lng: detectedLang,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

// Update document direction on language change
i18n.on('languageChanged', (lng) => {
  document.documentElement.dir = lng === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.lang = lng;
});

// Set initial direction
if (typeof document !== 'undefined') {
  document.documentElement.dir = detectedLang === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.lang = detectedLang;
}

export default i18n;
