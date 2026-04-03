import React from 'react';

export const Badge: React.FC<{ status: string; children: React.ReactNode }> = ({ status, children }) => {
  const statusColors: Record<string, string> = {
    idle: 'bg-zinc-800 text-zinc-400 border-zinc-700',
    busy: 'bg-amber-950/30 text-amber-500 border-amber-900/50',
    assigned: 'bg-blue-950/30 text-blue-400 border-blue-900/50',
    in_progress: 'bg-blue-950/30 text-blue-400 border-blue-900/50',
    review: 'bg-violet-950/30 text-violet-400 border-violet-900/50',
    merged: 'bg-emerald-950/30 text-emerald-400 border-emerald-900/50',
    failed: 'bg-rose-950/30 text-rose-400 border-rose-900/50',
    blocked: 'bg-rose-950/30 text-rose-400 border-rose-900/50',
    disabled: 'bg-zinc-900 text-zinc-600 border-zinc-800 line-through',
  };

  const colorClass = statusColors[status.toLowerCase()] || 'bg-zinc-800 text-zinc-400 border-zinc-700';

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${colorClass}`}>
      {children}
    </span>
  );
};

export const Panel: React.FC<{ title: string; children: React.ReactNode; className?: string }> = ({ title, children, className }) => {
  return (
    <section className={`bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden flex flex-col shadow-2xl ${className}`}>
      <div className="px-5 py-4 border-b border-zinc-800 bg-zinc-900/30">
        <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-widest">{title}</h2>
      </div>
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </section>
  );
};
