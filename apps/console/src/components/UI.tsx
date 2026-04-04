import React from 'react';

export const Badge: React.FC<{ status: string; children: React.ReactNode }> = ({ status, children }) => {
  const statusConfig: Record<string, { colors: string; dot: string }> = {
    idle: { colors: 'bg-white/10 text-white/60 border-white/20', dot: 'bg-white/40' },
    busy: { colors: 'bg-amber-500/20 text-amber-300 border-amber-500/30', dot: 'bg-amber-400' },
    assigned: { colors: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30', dot: 'bg-cyan-400' },
    in_progress: { colors: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30', dot: 'bg-cyan-400' },
    review: { colors: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30', dot: 'bg-fuchsia-400' },
    merged: { colors: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', dot: 'bg-emerald-400' },
    failed: { colors: 'bg-rose-500/20 text-rose-300 border-rose-500/30', dot: 'bg-rose-400' },
    blocked: { colors: 'bg-rose-500/20 text-rose-300 border-rose-500/30', dot: 'bg-rose-400' },
    disabled: { colors: 'bg-white/5 text-white/30 border-white/10 line-through', dot: 'bg-white/20' },
  };

  const config = statusConfig[status.toLowerCase()] || statusConfig.idle;

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold uppercase tracking-wide transition-all duration-200 ${config.colors}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot} ${status !== 'disabled' && status !== 'idle' ? 'animate-pulse' : ''}`}></span>
      {children}
    </span>
  );
};

export const Panel: React.FC<{ title: string; children: React.ReactNode; className?: string }> = ({ title, children, className }) => {
  return (
    <section className={`glass-card rounded-2xl flex flex-col overflow-hidden ${className}`}>
      <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white uppercase tracking-wide flex items-center gap-2">
          <span className="w-2 h-2 bg-cyan-400 rounded-full shadow-[0_0_8px_rgba(34,211,238,0.6)]"></span>
          {title}
        </h2>
      </div>
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </section>
  );
};
