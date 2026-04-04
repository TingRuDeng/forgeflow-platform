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
    <div className="min-h-screen bg-[#020202] text-foreground font-mono selection:bg-primary selection:text-black">
      <div className="max-w-[1600px] mx-auto px-10 py-10 flex flex-col gap-10">
        <header className="flex justify-between items-center pb-8 border-b border-zinc-900/50">
          <h1 className="text-2xl font-black tracking-[-0.05em] text-white flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-black font-black text-lg shadow-[0_0_20px_rgba(0,255,255,0.3)]">F</div>
            FORGEFLOW <span className="text-zinc-600 font-light tracking-widest">CONSOLE</span>
          </h1>
          <div className="flex items-center gap-6">
            <button
              onClick={toggleLanguage}
              className="px-4 py-1.5 rounded text-[10px] uppercase font-black tracking-widest text-zinc-500 hover:text-primary hover:bg-zinc-900/50 transition-all border border-transparent hover:border-zinc-800"
            >
              {lang === 'zh' ? 'EN' : 'ZH'}
            </button>
            <div className="bg-zinc-900/30 border border-zinc-800/50 px-5 py-2 rounded-full text-[10px] font-bold text-zinc-500 flex items-center gap-3 backdrop-blur-sm">
              <div className={cn(
                "w-1.5 h-1.5 rounded-full",
                isConnecting ? "bg-zinc-600" : "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)] animate-pulse"
              )} />
              <span className="tracking-tight lowercase">
                {isConnecting ? t('connecting') : `${t('lastUpdate')} @ ${formatTime(updatedAt)}`}
              </span>
            </div>
          </div>
        </header>

        <main className="flex flex-col gap-10">
          {children}
        </main>
      </div>
    </div>
  );
};
