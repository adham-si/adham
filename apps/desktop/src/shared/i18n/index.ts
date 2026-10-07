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
      },
      status: {
        ready: 'Ready',
        loading: 'Loading...',
        error: 'An error occurred',
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
      },
      status: {
        ready: 'جاهز',
        loading: 'جارٍ التحميل...',
        error: 'حدث خطأ',
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
      },
      status: {
        ready: '就绪',
        loading: '加载中...',
        error: '发生错误',
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
      },
      status: {
        ready: 'Готово',
        loading: 'Загрузка...',
        error: 'Произошла ошибка',
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
