import React, { useRef, useEffect } from 'react';
import { useTranslation } from '@/lib/i18n';
import { Panel } from './UI';
import JsonView from '@uiw/react-json-view';
import { darkTheme } from '@uiw/react-json-view/dark';

interface Event {
  taskId: string;
  type: string;
  payload: any;
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
    <Panel title={t('events')} className="h-full min-h-[500px] border-zinc-800">
      <div 
        ref={scrollRef}
        // 增加背景的深邃感和滚动条美化
        className="bg-[#050505] p-4 font-mono text-[12px] leading-relaxed overflow-y-auto h-[600px] scrollbar-thin scrollbar-track-transparent scrollbar-thumb-zinc-800 relative"
      >
        {/* 伪终端头部装饰 */}
        <div className="sticky top-0 pb-4 mb-2 bg-[#050505]/90 backdrop-blur-sm border-b border-zinc-900 z-10 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500/80"></div>
          <div className="w-2 h-2 rounded-full bg-yellow-500/80"></div>
          <div className="w-2 h-2 rounded-full bg-green-500/80"></div>
          <span className="ml-2 text-zinc-600 text-[10px] tracking-widest">SYSTEM_LOG_STREAM</span>
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
                  // 这里的 animate-in 配合 tailwindcss-animate 实现了新日志推入的动画
                  className="border-l-2 border-zinc-800 pl-3 py-1 hover:bg-zinc-900/30 transition-colors animate-in fade-in slide-in-from-bottom-4 duration-500"
                >
                  <div className="flex justify-between items-center mb-2 opacity-90">
                    <span className="font-bold text-emerald-400 tracking-wider flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse box-shadow-glow"></span>
                      {ev.taskId}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-zinc-500 font-mono opacity-50 whitespace-nowrap">
                        {ev.at ? ev.at.split('T')[1]?.split('.')[0] : '--:--:--'}
                      </span>
                      <span className="text-[10px] text-zinc-400 bg-zinc-900/80 px-2 py-0.5 rounded uppercase border border-zinc-800">
                        {t(`eventType.${ev.type}`)}
                      </span>
                    </div>
                  </div>
                  
                  {/* 核心高亮区域 */}
                  <div className="text-sky-400/90 break-all overflow-hidden rounded bg-black/40 p-2.5 border border-zinc-800/50">
                    {isString ? (
                      <div className="whitespace-pre-wrap">{ev.payload}</div>
                    ) : (
                      <div className="text-[11px]">
                        <JsonView 
                          value={ev.payload} 
                          style={darkTheme}
                          collapsed={2} // 自动折叠超过2层级的深层数据
                          displayDataTypes={false} // 隐藏数据类型(如: Object/Array)让界面更极简
                          displayObjectSize={false} // 隐藏字段数量
                          shortenTextAfterLength={120} // 超长文本截断
                          className="!bg-transparent" // 强制透明背景以融入外层框
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
