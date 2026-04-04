import React from 'react';

export const Badge: React.FC<{ status: string; children: React.ReactNode }> = ({ status, children }) => {
  const statusColors: Record<string, string> = {
    idle: 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50',
    busy: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    assigned: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    in_progress: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
    review: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    merged: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    failed: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    blocked: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    disabled: 'bg-zinc-900 text-zinc-600 border-zinc-800 opacity-60',
  };

  const colorClass = statusColors[status.toLowerCase()] || 'bg-zinc-800 text-zinc-400 border-zinc-700';

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border transition-all ${colorClass}`}>
      {children}
    </span>
  );
};

export const Panel: React.FC<{ title: string; children: React.ReactNode; className?: string }> = ({ title, children, className }) => {
  return (
    <section className={`bg-[#030303] border border-zinc-800/80 rounded-lg overflow-hidden flex flex-col shadow-[0_8px_30px_rgb(0,0,0,0.12)] bg-grid-zinc-900/[0.02] ${className}`}>
      <div className="px-5 py-3.5 border-b border-zinc-800/50 bg-zinc-900/10 backdrop-blur-md flex items-center justify-between">
        <h2 className="text-[11px] font-bold text-zinc-400 uppercase tracking-[0.2em]">{title}</h2>
        <div className="flex gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-zinc-800" />
          <div className="w-1.5 h-1.5 rounded-full bg-zinc-800" />
        </div>
      </div>
      <div className="flex-1 overflow-auto bg-gradient-to-b from-transparent to-zinc-900/5">
        {children}
      </div>
    </section>
  );
};
