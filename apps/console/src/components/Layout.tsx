import React from 'react';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface LayoutProps {
  children: React.ReactNode;
  updatedAt?: string;
  isConnecting?: boolean;
}

export const Layout: React.FC<LayoutProps> = ({ children, updatedAt, isConnecting }) => {
  const { lang, setLang, t } = useTranslation();

  const toggleLanguage = () => {
    setLang(lang === 'zh' ? 'en' : 'zh');
  };

  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US', { hour12: false }) + 
           '.' + String(date.getMilliseconds()).padStart(3, '0');
  };

  return (
    <div className="min-h-screen text-foreground font-sans selection:bg-primary selection:text-black">
      <div className="max-w-[1600px] mx-auto px-6 py-6 flex flex-col gap-6">
        <header className="glass rounded-2xl px-6 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-3">
            <div className="w-10 h-10 glass-button rounded-lg flex items-center justify-center text-white font-bold text-lg shadow-lg">
              F
            </div>
            <div>
              <div className="text-white">FORGEFLOW</div>
              <div className="text-xs text-white/50 tracking-widest">CONSOLE</div>
            </div>
          </h1>
          <div className="flex items-center gap-6">
            <button
              onClick={toggleLanguage}
              className="glass-button px-4 py-2 rounded-lg text-xs font-semibold text-white/80 hover:text-white"
            >
              {lang === 'zh' ? 'EN' : 'ZH'}
            </button>
            <div className="glass-button rounded-full px-4 py-2 text-xs font-semibold text-white/70 flex items-center gap-3">
              <div className={cn(
                "w-2 h-2 rounded-full",
                isConnecting ? "bg-white/40" : "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
              )} />
              <span className="tracking-tight">
                {isConnecting ? t('connecting') : `${t('lastUpdate')} @ ${formatTime(updatedAt)}`}
              </span>
            </div>
          </div>
        </header>

        <main className="flex flex-col gap-6">
          {children}
        </main>
      </div>
    </div>
  );
};
