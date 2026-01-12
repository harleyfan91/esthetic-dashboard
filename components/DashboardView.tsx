
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell
} from 'recharts';
import { 
  TrendingUp, BrainCircuit, Loader2, Rocket, Target, 
  Lightbulb, Download, Trash2, Star, ChevronRight, ListFilter, Sparkles,
  ShoppingBag, CalendarDays, Calendar
} from 'lucide-react';
import { MasterRecord, SaleRecord } from '../types';
import { GoogleGenAI } from "@google/genai";
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface DashboardViewProps {
  master: MasterRecord;
  onSaveAnalysis: (insight: string) => void;
}

type TimeRange = 'all' | '7d' | '30d' | 'custom';

const COLORS = ['#6366f1', '#f97316', '#059669', '#8b5cf6', '#ec4899', '#f59e0b'];

const CustomRevenueTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const [y, m, d] = data.date.split('-').map(Number);
    const dateStr = new Date(y, m-1, d).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    return (
      <div className="bg-slate-900 text-white p-4 rounded-2xl shadow-2xl border border-slate-800 animate-in zoom-in duration-200 min-w-[200px]">
        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">{dateStr}</p>
        <p className="text-xl font-black mb-3 text-white">${data.revenue.toLocaleString()}</p>
        <div className="space-y-1.5 border-t border-slate-800 pt-3">
           <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Details</p>
           {data.items.slice(0, 5).map((item: any, idx: number) => (
             <div key={idx} className="flex justify-between gap-4 text-[10px] font-bold">
               <span className="text-slate-300 truncate max-w-[140px]">{item.name}</span>
               <span className="text-indigo-400 shrink-0">x{item.qty}</span>
             </div>
           ))}
        </div>
      </div>
    );
  }
  return null;
};

export const DashboardView: React.FC<DashboardViewProps> = ({ master, onSaveAnalysis }) => {
  const [strategy, setStrategy] = useState<string | null>(master.lastStrategicInsight || null);
  const [lastAnalyzedRange, setLastAnalyzedRange] = useState<TimeRange | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');
  const dashboardRef = useRef<HTMLDivElement>(null);

  const filteredData = useMemo(() => {
    if (timeRange === 'all') return master.data;
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    let cutoff: Date | null = null;
    let endLimit: Date = now;
    if (timeRange === '7d') { cutoff = new Date(now); cutoff.setDate(now.getDate() - 7); }
    else if (timeRange === '30d') { cutoff = new Date(now); cutoff.setDate(now.getDate() - 30); }
    else if (timeRange === 'custom' && customStart && customEnd) { cutoff = new Date(customStart); endLimit = new Date(customEnd); endLimit.setHours(23, 59, 59, 999); }
    if (!cutoff) return master.data;
    return master.data.filter(s => {
      const recordDate = new Date(s.date);
      return recordDate >= cutoff! && recordDate <= endLimit;
    });
  }, [master.data, timeRange, customStart, customEnd]);

  const stats = useMemo(() => {
    const totalRevenue = filteredData.reduce((acc, s) => acc + s.amount, 0);
    const totalItems = filteredData.reduce((acc, s) => acc + s.quantity, 0);
    const productMap: Record<string, { count: number, revenue: number }> = {};
    const categoryMap: Record<string, number> = {};
    filteredData.forEach(s => {
      if (!productMap[s.product]) productMap[s.product] = { count: 0, revenue: 0 };
      productMap[s.product].count += s.quantity;
      productMap[s.product].revenue += s.amount;
      categoryMap[s.category] = (categoryMap[s.category] || 0) + s.amount;
    });
    const categoryData = Object.entries(categoryMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    const sortedProducts = Object.entries(productMap).sort((a, b) => b[1].count - a[1].count);
    const topProduct = sortedProducts[0];
    const starPerformers = Object.entries(productMap).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5).map(([name, data]) => ({ name, count: data.count, revenue: data.revenue }));
    return { totalRevenue, totalItems, topProduct, starPerformers, categoryData };
  }, [filteredData]);

  const revenueTrend = useMemo(() => {
    type DailyTrendItem = { revenue: number, items: {name: string, qty: number}[] };
    const daily = filteredData.reduce<Record<string, DailyTrendItem>>((acc, s) => {
      if (!acc[s.date]) acc[s.date] = { revenue: 0, items: [] };
      acc[s.date].revenue += s.amount;
      const existing = acc[s.date].items.find(i => i.name === s.product);
      if (existing) existing.qty += s.quantity; else acc[s.date].items.push({ name: s.product, qty: s.quantity });
      return acc;
    }, {} as Record<string, DailyTrendItem>);
    return (Object.entries(daily) as [string, DailyTrendItem][]).map(([date, data]) => ({ date, revenue: data.revenue, items: data.items })).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [filteredData]);

  const busiestDays = useMemo(() => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const counts = new Array(7).fill(0);
    filteredData.forEach(s => {
      const day = new Date(s.date).getDay();
      counts[day] += s.quantity;
    });
    return days.map((name, i) => ({ name, value: counts[i] }));
  }, [filteredData]);

  const getStrategicAnalysis = async (force = false) => {
    if (filteredData.length === 0) return;
    const dataHasChanged = !master.analysisTimestamp || new Date(master.lastUpdated) > new Date(master.analysisTimestamp);
    const rangeChanged = lastAnalyzedRange !== timeRange;
    if (!force && !dataHasChanged && !rangeChanged && strategy) return;
    setIsAiLoading(true);
    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey) {
        if (window.aistudio?.openSelectKey) await window.aistudio.openSelectKey();
        setIsAiLoading(false);
        return;
      }
      const ai = new GoogleGenAI({ apiKey });
      const summary = { totalRecords: filteredData.length, totalRevenue: stats.totalRevenue, topProduct: stats.topProduct, timeSpanLabel: timeRange };
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Business Analysis for scope "${summary.timeSpanLabel}": ${JSON.stringify(summary)}. Output 4 brief segments separated by "---": 1. Motivational sentence (max 12 words) starting with "DRIVE: ". 2. WIN: Biggest success factor. 3. RISK: Potential weakness. 4. ACTION: Single move for growth.`,
      });
      const insight = response.text || "Sales trends look solid.";
      setStrategy(insight);
      setLastAnalyzedRange(timeRange);
      onSaveAnalysis(insight);
    } catch (err: any) {
      console.error("Analysis failed:", err);
      if (err.message?.includes('API Key')) {
        if (window.aistudio?.openSelectKey) await window.aistudio.openSelectKey();
      }
    } finally { setIsAiLoading(false); }
  };

  useEffect(() => { getStrategicAnalysis(); }, [filteredData.length, timeRange, master.lastUpdated, customStart, customEnd]);

  const parsedSections = strategy ? strategy.split('---').filter(Boolean) : [];
  const driveSentenceRaw = parsedSections.find(s => s.includes('DRIVE:')) || "";
  const driveSentence = driveSentenceRaw.replace('DRIVE:', '').trim() || "Every sale matters. Keep building!";
  const deepInsights = parsedSections.filter(s => !s.includes('DRIVE:'));

  const handleExportPdf = async () => {
    if (!dashboardRef.current) return;
    setIsExporting(true);
    const exportElements = document.querySelectorAll('.no-export');
    exportElements.forEach(el => (el as HTMLElement).style.display = 'none');
    try {
      const canvas = await html2canvas(dashboardRef.current, { scale: 2, useCORS: true, backgroundColor: '#f8fafc' });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Sales-Dashboard-${master.name}.pdf`);
    } catch (err) { console.error("Export failed:", err); } 
    finally { exportElements.forEach(el => (el as HTMLElement).style.display = ''); setIsExporting(false); }
  };

  const clearData = () => { if (confirm("Delete history?")) { localStorage.removeItem('maker_master_record'); window.location.reload(); } };

  return (
    <div className="space-y-8 pb-24" ref={dashboardRef}>
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight">Dashboard</h1>
          <p className="text-slate-500 font-medium">Daily business metrics powered by Gemini Flash.</p>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto no-export">
          <button onClick={handleExportPdf} disabled={isExporting} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-3 bg-[#059669] text-white rounded-2xl font-bold shadow-lg shadow-emerald-100 text-sm">
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            PDF Report
          </button>
          <button onClick={() => getStrategicAnalysis(true)} disabled={isAiLoading || filteredData.length === 0} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-2xl font-bold hover:bg-indigo-600 transition-all text-sm">
            {isAiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <BrainCircuit className="w-4 h-4" />}
            Analyze
          </button>
        </div>
      </header>

      <div className="bg-white rounded-[32px] p-3 border border-slate-100 shadow-sm flex items-center gap-2 no-export">
         {(['all', '7d', '30d'] as TimeRange[]).map((r) => (
           <button key={r} onClick={() => setTimeRange(r)} className={`px-5 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all ${timeRange === r ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-50 text-slate-400'}`}>
             {r === 'all' ? 'Full History' : r === '7d' ? '7 Days' : '30 Days'}
           </button>
         ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <KPIContainer label="Revenue" value={`$${stats.totalRevenue.toLocaleString()}`}>
          <div className="h-48 mt-6">
             {stats.categoryData.length > 0 && (
               <ResponsiveContainer width="100%" height="100%">
                 <PieChart>
                   <Pie data={stats.categoryData} innerRadius={45} outerRadius={75} dataKey="value">
                     {stats.categoryData.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                   </Pie>
                   <Tooltip />
                 </PieChart>
               </ResponsiveContainer>
             )}
          </div>
        </KPIContainer>
        <KPIContainer label="Total Items" value={stats.totalItems.toLocaleString()}>
          <div className="mt-6 space-y-3">
             {filteredData.slice(-5).reverse().map((s, i) => (
               <div key={i} className="flex justify-between text-[10px] font-bold border-b pb-2">
                 <span className="text-slate-500 truncate">{s.product}</span>
                 <span className="text-indigo-600">x{s.quantity}</span>
               </div>
             ))}
          </div>
        </KPIContainer>
        <KPIContainer label="Top Seller" value={stats.topProduct ? stats.topProduct[0] : 'None'} subtitle={`${stats.topProduct ? stats.topProduct[1].count : 0} units`}>
           <div className="mt-8 p-5 bg-indigo-50 rounded-3xl">
              <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Status</p>
              <p className="text-xs font-bold text-indigo-900 italic">Leading sales volume.</p>
           </div>
        </KPIContainer>
      </div>

      <div className="bg-slate-900 rounded-[40px] p-8 md:p-10 text-white shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <BrainCircuit className="w-6 h-6 text-indigo-400" />
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400">Gemini Strategy</span>
        </div>
        <h2 className="text-3xl font-black mb-10 leading-tight">
           {isAiLoading ? "Processing data..." : driveSentence}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
           {filteredData.length > 0 && deepInsights.map((text, i) => {
             const titles = ["SUCCESS", "GAP", "MOVE"];
             return (
               <div key={i} className="bg-white/5 border border-white/5 p-6 rounded-3xl">
                 <p className="text-[9px] font-black tracking-widest uppercase text-slate-500 mb-2">{titles[i]}</p>
                 <p className="text-sm text-slate-300 leading-relaxed">{text.split(':').slice(1).join(':').trim()}</p>
               </div>
             )
           })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-[40px] shadow-xl">
           <h3 className="text-xl font-black mb-8 flex items-center gap-3"><TrendingUp className="w-5 h-5 text-orange-500" /> Revenue</h3>
           <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueTrend}>
                  <XAxis dataKey="date" tick={{fontSize: 9}} />
                  <Tooltip />
                  <Area type="monotone" dataKey="revenue" stroke="#f97316" fill="#f97316" fillOpacity={0.1} />
                </AreaChart>
              </ResponsiveContainer>
           </div>
        </div>
        <div className="bg-white p-8 rounded-[40px] shadow-xl">
           <h3 className="text-xl font-black mb-8 flex items-center gap-3"><CalendarDays className="w-5 h-5 text-emerald-500" /> Best Days</h3>
           <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={busiestDays}>
                  <XAxis dataKey="name" tick={{fontSize: 9}} />
                  <Bar dataKey="value" fill="#059669" radius={[10, 10, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
           </div>
        </div>
      </div>

      <div className="pt-12 flex justify-end no-export">
         <button onClick={clearData} className="text-[10px] font-black text-slate-300 hover:text-red-500 uppercase tracking-widest flex items-center gap-2">
           <Trash2 className="w-4 h-4" /> Reset Records
         </button>
      </div>
    </div>
  );
};

const KPIContainer = ({ label, value, subtitle, children }: any) => {
  return (
    <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-xl min-h-[300px]">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">{label}</p>
      <p className="text-3xl font-black text-slate-900 tracking-tighter truncate">{value}</p>
      {subtitle && <p className="text-xs font-bold text-indigo-500 mt-2">{subtitle}</p>}
      {children}
    </div>
  );
};
