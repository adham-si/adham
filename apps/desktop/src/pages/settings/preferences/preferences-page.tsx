import { AppearanceSection, LanguageSection, EditorSection, DesktopSection } from './components';

export function PreferencesPage() {
  return (
    <div className="space-y-6">
      {/* Page Title & Subtitle */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">Preferences</h2>
        <p className="text-xs text-foreground-secondary mt-1">
          Customize your workspace theme, language, and interface layout.
        </p>
      </div>

      {/* Domain Sections */}
      <AppearanceSection />
      <LanguageSection />
      <EditorSection />
      <DesktopSection />
    </div>
  );
}
