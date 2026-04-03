import React, { useRef, useEffect } from 'react';
import { useTranslation } from '@/lib/i18n';
import { Panel } from './UI';

interface Event {
  taskId: string;
  type: string;
  payload: any;
}

export const TerminalPanel: React.FC<{ events: Event[] }> = ({ events }) => {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  return (
    <Panel title={t('events')} className="h-full min-h-[500px]">
      <div 
        ref={scrollRef}
        className="bg-black p-4 font-mono text-[11px] leading-relaxed overflow-y-auto h-[600px] scrollbar-thin scrollbar-thumb-zinc-800"
      >
        {!events || events.length === 0 ? (
          <div className="text-zinc-700 italic">{t('noRecentEvents')}</div>
        ) : (
          events.map((ev, i) => (
            <div key={i} className="mb-4 border-l border-zinc-800 pl-3">
              <div className="flex justify-between text-emerald-500 mb-1 opacity-80">
                <span className="font-bold tracking-wider">{ev.taskId}</span>
                <span className="text-[10px] uppercase">{t(`eventType.${ev.type}`)}</span>
              </div>
              <div className="text-sky-500 break-all whitespace-pre-wrap">
                {typeof ev.payload === 'string' ? ev.payload : JSON.stringify(ev.payload, null, 2)}
              </div>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
};
