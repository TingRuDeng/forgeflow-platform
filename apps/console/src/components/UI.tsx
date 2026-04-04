import React from 'react';

export const Badge: React.FC<{ status: string; children: React.ReactNode }> = ({ status, children }) => {
  // 将单一的 class 拆分为外框颜色和指示灯颜色，并增加发光阴影
  const statusConfig: Record<string, { colors: string; dot: string }> = {
    idle: { colors: 'bg-zinc-900/50 text-zinc-400 border-zinc-700/50', dot: 'bg-zinc-500' },
    busy: { colors: 'bg-amber-950/40 text-amber-400 border-amber-500/40 shadow-[0_0_8px_rgba(245,158,11,0.2)]', dot: 'bg-amber-400' },
    assigned: { colors: 'bg-sky-950/40 text-sky-400 border-sky-500/40 shadow-[0_0_8px_rgba(14,165,233,0.2)]', dot: 'bg-sky-400' },
    in_progress: { colors: 'bg-sky-950/40 text-sky-400 border-sky-500/40 shadow-[0_0_8px_rgba(14,165,233,0.2)]', dot: 'bg-sky-400' },
    review: { colors: 'bg-fuchsia-950/40 text-fuchsia-400 border-fuchsia-500/40 shadow-[0_0_8px_rgba(217,70,239,0.2)]', dot: 'bg-fuchsia-400' },
    merged: { colors: 'bg-emerald-950/40 text-emerald-400 border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.2)]', dot: 'bg-emerald-400' },
    failed: { colors: 'bg-rose-950/40 text-rose-400 border-rose-500/40 shadow-[0_0_8px_rgba(244,63,94,0.2)]', dot: 'bg-rose-400' },
    blocked: { colors: 'bg-rose-950/40 text-rose-400 border-rose-500/40 shadow-[0_0_8px_rgba(244,63,94,0.2)]', dot: 'bg-rose-400' },
    disabled: { colors: 'bg-zinc-950 text-zinc-600 border-zinc-800 line-through', dot: 'bg-zinc-800' },
  };

  const config = statusConfig[status.toLowerCase()] || statusConfig.idle;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider backdrop-blur-sm transition-colors ${config.colors}`}>
      {/* 呼吸灯特效 */}
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot} ${status !== 'disabled' && status !== 'idle' ? 'animate-pulse' : ''}`}></span>
      {children}
    </span>
  );
};

export const Panel: React.FC<{ title: string; children: React.ReactNode; className?: string }> = ({ title, children, className }) => {
  return (
    <section className={`bg-[#050505] border border-zinc-800 rounded-xl overflow-hidden flex flex-col shadow-2xl ${className}`}>
      <div className="px-5 py-3 border-b border-zinc-800/80 bg-zinc-900/20">
        <h2 className="text-xs font-bold text-zinc-300 uppercase tracking-[0.2em]">{title}</h2>
      </div>
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </section>
  );
};
