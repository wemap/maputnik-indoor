import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Language is fixed to English. No detection, no switching.
i18n
  .use(initReactI18next)
  .init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: {} } },
    keySeparator: false,
    nsSeparator: false,
    interpolation: {
      escapeValue: false
    },
  });

export default i18n;
