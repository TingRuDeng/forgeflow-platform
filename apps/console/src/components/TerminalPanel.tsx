import React, { useRef, useEffect } from 'react';
import { useTranslation } from '@/lib/i18n';
import { Panel } from './UI';
import JsonView from '@uiw/react-json-view';
import { darkTheme } from '@uiw/react-json-view/dark';

const FOLLOW_BOTTOM_THRESHOLD_PX = 80;

interface Event {
  taskId: string;
  type: string;
  payload: unknown;
  at?: string; // ISO timestamp
}

function getEventKey(event: Event, index: number) {
  return `${event.taskId}:${event.type}:${event.at || index}`;
}

function shouldFollowBottom(node: HTMLDivElement) {
  const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
  return distanceFromBottom <= FOLLOW_BOTTOM_THRESHOLD_PX;
}

const EventPayload: React.FC<{ payload: unknown }> = ({ payload }) => {
  const isString = typeof payload === 'string';

  return (
    <div className="text-[#94a3b8] break-all overflow-hidden rounded-lg bg-black/30 p-3 border border-white/[0.05]">
      {isString ? (
        <div className="whitespace-pre-wrap text-sm">{String(payload ?? '')}</div>
      ) : (
        <div className="text-xs">
          <JsonView
            value={payload as object}
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
  );
};

const EventRow: React.FC<{ event: Event }> = ({ event }) => (
  <div className="border-l-2 border-cyan-900/40 pl-4 py-2 hover:bg-white/[0.03] transition-colors duration-200 rounded-r-md">
    <div className="flex justify-between items-center gap-3 mb-2">
      <span className="font-semibold text-[#7dd3fc] tracking-wide flex items-center gap-2 text-sm min-w-0 break-all">
        <span className="w-2 h-2 rounded-full bg-[#34d399] shrink-0"></span>
        {event.taskId}
      </span>
      <span className="text-xs text-zinc-500 font-mono whitespace-nowrap tabular-nums">
        {event.at ? event.at.split('T')[1]?.split('.')[0] : '--:--:--'}
      </span>
    </div>

    <EventPayload payload={event.payload} />
  </div>
);

export const TerminalPanel: React.FC<{ events: Event[] }> = ({ events }) => {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const followLiveRef = useRef(true);
  const sortedEvents = [...(events || [])].reverse();

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || typeof node.scrollTo !== 'function' || !followLiveRef.current) {
      return;
    }
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }, [events]);

  const handleScroll = () => {
    const node = scrollRef.current;
    if (node) {
      followLiveRef.current = shouldFollowBottom(node);
    }
  };

  return (
    <Panel title={t('events')} className="h-full min-h-[420px]">
      <div
        ref={scrollRef}
        data-testid="terminal-scroll"
        onScroll={handleScroll}
        className="bg-[#0a0f1a]/95 p-4 sm:p-5 font-mono text-sm leading-[1.8] overflow-y-auto h-[min(600px,65vh)] relative backdrop-blur-sm"
      >
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
            {sortedEvents.map((event, index) => (
              <EventRow key={getEventKey(event, index)} event={event} />
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
};
