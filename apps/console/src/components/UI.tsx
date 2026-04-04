import React from 'react';

export const Badge: React.FC<{ status: string; children: React.ReactNode }> = ({ status, children }) => {
  const statusConfig: Record<string, { colors: string; dot: string }> = {
    idle: { colors: 'bg-zinc-900/50 text-zinc-400 border-zinc-700/50', dot: 'bg-zinc-500' },
    busy: { colors: 'bg-amber-500/10 text-amber-400 border-amber-500/50 shadow-[0_0_12px_rgba(245,158,11,0.3)]', dot: 'bg-amber-400' },
    assigned: { colors: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/50 shadow-[0_0_12px_rgba(6,182,212,0.4)]', dot: 'bg-cyan-400' },
    in_progress: { colors: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/50 shadow-[0_0_12px_rgba(6,182,212,0.4)]', dot: 'bg-cyan-400' },
    review: { colors: 'bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/50 shadow-[0_0_12px_rgba(217,70,239,0.3)]', dot: 'bg-fuchsia-400' },
    merged: { colors: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/50 shadow-[0_0_12px_rgba(16,185,129,0.3)]', dot: 'bg-emerald-400' },
    failed: { colors: 'bg-rose-500/10 text-rose-400 border-rose-500/50 shadow-[0_0_12px_rgba(244,63,94,0.3)]', dot: 'bg-rose-400' },
    blocked: { colors: 'bg-rose-500/10 text-rose-400 border-rose-500/50 shadow-[0_0_12px_rgba(244,63,94,0.3)]', dot: 'bg-rose-400' },
    disabled: { colors: 'bg-zinc-950 text-zinc-600 border-zinc-800 line-through', dot: 'bg-zinc-800' },
  };

  const config = statusConfig[status.toLowerCase()] || statusConfig.idle;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider backdrop-blur-sm transition-all duration-300 ${config.colors}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot} ${status !== 'disabled' && status !== 'idle' ? 'animate-pulse' : ''}`}></span>
      {children}
    </span>
  );
};

export const Panel: React.FC<{ title: string; children: React.ReactNode; className?: string }> = ({ title, children, className }) => {
  return (
    <section className={`relative bg-zinc-950/60 backdrop-blur-md border border-zinc-800/80 rounded-lg flex flex-col shadow-2xl ${className}`}>
      {/* 顶部赛博朋克发光线条 */}
      <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent"></div>
      
      {/* 机械感头部 */}
      <div className="px-5 py-3 border-b border-zinc-800/80 bg-gradient-to-b from-cyan-950/20 to-transparent flex items-center justify-between">
        <h2 className="text-[11px] font-bold text-zinc-300 uppercase tracking-[0.25em] flex items-center gap-2">
          <span className="w-2 h-2 bg-cyan-500/80 shadow-[0_0_8px_rgba(6,182,212,0.8)]"></span>
          {title}
        </h2>
        <div className="flex gap-1 opacity-40">
          <div className="w-1 h-1 bg-zinc-400 rounded-sm"></div>
          <div className="w-1 h-1 bg-zinc-400 rounded-sm"></div>
          <div className="w-1 h-1 bg-zinc-400 rounded-sm"></div>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </section>
  );
};
