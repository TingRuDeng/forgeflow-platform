import React, { useRef, useEffect } from 'react';
import { useTranslation } from '@/lib/i18n';
import { Panel } from './UI';
import JsonView from '@uiw/react-json-view';
import { darkTheme } from '@uiw/react-json-view/dark';

interface Event {
  taskId: string;
  type: string;
  payload: unknown;
  at?: string; // ISO timestamp
}

export const TerminalPanel: React.FC<{ events: Event[] }> = ({ events }) => {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  // 反转事件数组，使最新的事件在底部
  const sortedEvents = [...(events || [])].reverse();

  // 当有新事件推入时，平滑滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [events]);

  return (
    <Panel title={t('events')} className="h-full min-h-[500px]">
      <div 
        ref={scrollRef}
        className="glass-card p-4 font-mono text-xs leading-relaxed overflow-y-auto h-[600px] relative"
      >
        {/* 伪终端头部装饰 */}
        <div className="sticky top-0 pb-4 mb-2 glass rounded-lg px-3 py-2 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-rose-400/80 shadow-[0_0_8px_rgba(251,113,133,0.6)]"></div>
          <div className="w-2 h-2 rounded-full bg-amber-400/80 shadow-[0_0_8px_rgba(251,191,36,0.6)]"></div>
          <div className="w-2 h-2 rounded-full bg-emerald-400/80 shadow-[0_0_8px_rgba(52,211,153,0.6)]"></div>
          <span className="ml-2 text-white/50 text-xs tracking-widest">SYSTEM_LOG_STREAM</span>
        </div>

        {!events || events.length === 0 ? (
          <div className="text-zinc-600 italic animate-pulse mt-4">{t('noRecentEvents')}</div>
        ) : (
          <div className="flex flex-col gap-3">
            {sortedEvents.map((ev, i) => {
              const isString = typeof ev.payload === 'string';
              
              return (
                <div 
                  key={i} 
                  className="border-l-2 border-white/20 pl-3 py-1 hover:bg-white/5 transition-colors duration-200"
                >
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-bold text-emerald-400 tracking-wide flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.6)]"></span>
                      {ev.taskId}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-white/50 font-mono whitespace-nowrap">
                        {ev.at ? ev.at.split('T')[1]?.split('.')[0] : '--:--:--'}
                      </span>
                      <span className="text-xs text-white/70 glass-button px-2 py-0.5 rounded uppercase">
                        {t(`eventType.${ev.type}`)}
                      </span>
                    </div>
                  </div>
                  
                  <div className="text-cyan-400/90 break-all overflow-hidden rounded-lg glass-card p-2.5">
                    {isString ? (
                      <div className="whitespace-pre-wrap">{ev.payload}</div>
                    ) : (
                      <div className="text-xs">
                        <JsonView 
                          value={ev.payload} 
                          style={darkTheme}
                          collapsed={2}
                          displayDataTypes={false}
                          displayObjectSize={false}
                          shortenTextAfterLength={120}
                          className="!bg-transparent"
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Panel>
  );
};
