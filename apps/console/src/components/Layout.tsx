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
    <div className="min-h-screen bg-black text-foreground font-mono selection:bg-primary selection:text-black">
      <div className="max-w-[1400px] mx-auto px-6 py-8 flex flex-col gap-8">
        <header className="flex justify-between items-center pb-6 border-b border-zinc-800">
          <h1 className="text-3xl font-bold tracking-tight text-white">
            ForgeFlow <span className="text-primary">Console</span>
          </h1>
          <div className="flex items-center gap-4">
            <button
              onClick={toggleLanguage}
              className="bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-md text-xs hover:bg-primary hover:text-black transition-colors"
            >
              {lang === 'zh' ? 'English' : '中文'}
            </button>
            <div className="bg-zinc-900 border border-zinc-800 px-4 py-1.5 rounded-full text-xs text-zinc-400 flex items-center gap-2">
              <div className={cn(
                "w-2 h-2 rounded-full",
                isConnecting ? "bg-zinc-600" : "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse"
              )} />
              <span>
                {isConnecting ? t('connecting') : `${t('lastUpdate')} ${formatTime(updatedAt)}`}
              </span>
            </div>
          </div>
        </header>

        <main className="flex flex-col gap-8">
          {children}
        </main>
      </div>
    </div>
  );
};
