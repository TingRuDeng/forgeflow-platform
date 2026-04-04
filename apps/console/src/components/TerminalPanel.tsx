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
        className="bg-[#0a0f1a]/95 p-5 font-mono text-sm leading-[1.8] overflow-y-auto h-[600px] relative backdrop-blur-sm"
      >
        {/* 伪终端头部装饰 */}
        <div className="sticky top-0 pb-4 mb-3 bg-[#0d1321] rounded-lg px-4 py-2.5 flex items-center gap-2 border border-white/[0.08]">
          <div className="w-2.5 h-2.5 rounded-full bg-[#ff6b6b]"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-[#ffd93d]"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-[#6bcb77]"></div>
          <span className="ml-3 text-zinc-400 text-xs tracking-widest font-medium">SYSTEM_LOG_STREAM</span>
        </div>

        {!events || events.length === 0 ? (
          <div className="text-zinc-500 italic mt-4 text-sm">{t('noRecentEvents')}</div>
        ) : (
          <div className="flex flex-col gap-4">
            {sortedEvents.map((ev, i) => {
              const isString = typeof ev.payload === 'string';
              
              return (
                <div 
                  key={i} 
                  className="border-l-2 border-cyan-900/40 pl-4 py-2 hover:bg-white/[0.03] transition-colors duration-200 rounded-r-md"
                >
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold text-[#7dd3fc] tracking-wide flex items-center gap-2 text-sm">
                      <span className="w-2 h-2 rounded-full bg-[#34d399]"></span>
                      {ev.taskId}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-zinc-400 font-mono whitespace-nowrap tabular-nums">
                        {ev.at ? ev.at.split('T')[1]?.split('.')[0] : '--:--:--'}
                      </span>
                      <span className="text-xs text-zinc-300 bg-white/[0.06] px-2.5 py-1 rounded-md uppercase font-medium border border-white/[0.08]">
                        {t(`eventType.${ev.type}`)}
                      </span>
                    </div>
                  </div>
                  
                  <div className="text-[#94a3b8] break-all overflow-hidden rounded-lg bg-black/30 p-3 border border-white/[0.05]">
                    {isString ? (
                      <div className="whitespace-pre-wrap text-sm">{ev.payload}</div>
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
