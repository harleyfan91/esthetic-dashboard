import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell
} from 'recharts';
import { 
  TrendingUp, BrainCircuit, Loader2, Download, Trash2, 
  CalendarDays, Calendar
} from 'lucide-react';
import { MasterRecord } from '../types';
import { GoogleGenAI, Type } from "@google/genai";
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface DashboardViewProps {
  master: MasterRecord;
  onSaveAnalysis: (insight: string) => void;
}

type TimeRange = 'all' | '7d' | '30d' | 'custom';

const COLORS = ['#6366f1', '#f97316', '#059669', '#8b5cf6', '#ec4899', '#f59e0b'];

// --- CUSTOM TOOLTIPS ---

const CustomDayTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-slate-900 text-white p-4 rounded-2xl shadow-2xl border border-slate-800 animate-in zoom-in duration-200 min-w-[140px]">
        <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-2">{label}</p>
        <div className="space-y-1">
           <div className="flex justify-between gap-4 text-xs font-medium">
             <span className="text-slate-400">Quantity:</span>
             <span className="text-white font-bold">{data.quantity}</span>
           </div>
           <div className="flex justify-between gap-4 text-xs font-medium">
             <span className="text-slate-400">Revenue:</span>
             <span className="text-white font-bold">${data.revenue.toLocaleString()}</span>
           </div>
        </div>
      </div>
    );
  }
  return null;
};

const CustomRevenueTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length && payload[0].value !== undefined) {
    return (
      <div className="bg-slate-900 text-white p-4 rounded-2xl shadow-2xl border border-slate-800 animate-in zoom-in duration-200 min-w-[140px]">
        <p className="text-[10px] font-black text-orange-400 uppercase tracking-widest mb-2">{label}</p>
        <div className="flex justify-between gap-4 text-xs font-medium">
             <span className="text-slate-400">Revenue:</span>
             <span className="text-white font-bold text-lg">${payload[0].value.toLocaleString()}</span>
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
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');
  
  const dashboardRef = useRef<HTMLDivElement>(null);

  // 1. FILTERING LOGIC
  const filteredData = useMemo(() => {
    if (timeRange === 'all') return master.data;

    const now = new Date();
    now.setHours(23, 59, 59, 999);

    let cutoff: Date | null = null;
    let startDateStr = '';
    let endDateStr = '';

    if (timeRange === '7d') { 
        cutoff = new Date(now); 
        cutoff.setDate(now.getDate() - 7); 
    }
    else if (timeRange === '30d') { 
        cutoff = new Date(now); 
        cutoff.setDate(now.getDate() - 30); 
    }
    else if (timeRange === 'custom') {
        if (!customStart || !customEnd) return master.data;
        startDateStr = customStart;
        endDateStr = customEnd;
    }

    return master.data.filter(s => {
      // Safety check for invalid dates
      if (!s.date) return false;
      
      if (timeRange === 'custom') {
          return s.date >= startDateStr && s.date <= endDateStr;
      }
      const recordDate = new Date(s.date);
      // Ensure date is valid before comparing
      return !isNaN(recordDate.getTime()) && recordDate >= cutoff!;
    });
  }, [master.data, timeRange, customStart, customEnd]);

  // 2. STATISTICS
  const stats = useMemo(() => {
    const totalRevenue = filteredData.reduce((acc, s) => acc + s.amount, 0);
    const totalItems = filteredData.reduce((acc, s) => acc + s.quantity, 0);
    
    const productMap: Record<string, { count: number, revenue: number }> = {};
    const categoryMap: Record<string, number> = {};

    filteredData.forEach(s => {
      const prodName = s.product || "Unknown";
      const catName = s.category || "General";

      if (!productMap[prodName]) productMap[prodName] = { count: 0, revenue: 0 };
      productMap[prodName].count += s.quantity;
      productMap[prodName].revenue += s.amount;
      
      categoryMap[catName] = (categoryMap[catName] || 0) + s.amount;
    });

    const categoryData = Object.entries(categoryMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    const sortedProducts = Object.entries(productMap)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.count - a.count);

    const topProduct = sortedProducts.length > 0 ? sortedProducts[0] : null;

    return { totalRevenue, totalItems, topProduct, sortedProducts, categoryData };
  }, [filteredData]);

  const revenueTrend = useMemo(() => {
    type DailyTrendItem = { revenue: number, items: {name: string, qty: number}[] };
    const daily = filteredData.reduce<Record<string, DailyTrendItem>>((acc, s) => {
      if (!s.date) return acc;
      if (!acc[s.date]) acc[s.date] = { revenue: 0, items: [] };
      acc[s.date].revenue += s.amount;
      return acc;
    }, {} as Record<string, DailyTrendItem>);
    
    return Object.entries(daily)
      .map(([date, data]) => ({ date, revenue: data.revenue }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredData]);

  const busiestDays = useMemo(() => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayStats = Array.from({ length: 7 }, () => ({ revenue: 0, quantity: 0 }));

    filteredData.forEach(s => {
      // ✅ CRASH PREVENTION: Validate date parts
      if (!s.date || !s.date.includes('-')) return;

      const parts = s.date.split('-').map(Number);
      if (parts.length !== 3) return;

      const [y, m, d] = parts;
      const localDate = new Date(y, m - 1, d);
      
      // Check for Invalid Date
      if (isNaN(localDate.getTime())) return;

      const dayIndex = localDate.getDay();
      
      // Ensure index is within bounds (0-6)
      if (dayIndex >= 0 && dayIndex < 7) {
        dayStats[dayIndex].quantity += s.quantity;
        dayStats[dayIndex].revenue += s.amount;
      }
    });

    return days.map((name, i) => ({ 
      name, 
      quantity: dayStats[i].quantity,
      revenue: dayStats[i].revenue 
    }));
  }, [filteredData]);

  // 3. AI ANALYSIS
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
      const summary = { 
        totalRecords: filteredData.length, 
        totalRevenue: stats.totalRevenue, 
        topProduct: stats.topProduct?.name, 
        timeSpanLabel: timeRange 
      };
      
      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: `Analyze this data: ${JSON.stringify(summary)}. 
        Return a JSON object with these 4 keys (strings):
        "drive": A 5-word motivational phrase.
        "win": The best performing aspect.
        "risk": A missing opportunity or risk.
        "action": One specific tactic to increase sales.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              drive: { type: Type.STRING },
              win: { type: Type.STRING },
              risk: { type: Type.STRING },
              action: { type: Type.STRING },
            }
          }
        }
      });
      
      const insightJson = response.text || "{}";
      setStrategy(insightJson);
      setLastAnalyzedRange(timeRange);
      onSaveAnalysis(insightJson);
    } catch (err: any) {
      console.error("Analysis failed:", err);
    } finally { setIsAiLoading(false); }
  };

  useEffect(() => { getStrategicAnalysis(); }, [filteredData.length, timeRange, master.lastUpdated]);

  // Parsing Logic (JSON or Fallback)
  let driveText = "Ready to analyze...";
  let insightCards = [
    { title: "SUCCESS", text: "Tracking sales data." },
    { title: "GAP", text: "Identifying trends..." },
    { title: "MOVE", text: "Calculating growth..." }
  ];

  if (filteredData.length === 0) {
     driveText = "Upload data to begin.";
     insightCards = [
        { title: "SUCCESS", text: "No data found." },
        { title: "GAP", text: "Upload a file." },
        { title: "MOVE", text: "Start tracking." }
     ];
  }

  if (strategy) {
    try {
      const parsed = JSON.parse(strategy);
      if (parsed.drive) {
        driveText = parsed.drive;
        insightCards = [
          { title: "SUCCESS", text: parsed.win },
          { title: "GAP", text: parsed.risk },
          { title: "MOVE", text: parsed.action }
        ];
      }
    } catch (e) {
      // Legacy Fallback
      const parts = strategy.split('---');
      const d = parts.find(s => s.includes('DRIVE:'));
      if (d) driveText = d.replace('DRIVE:', '').trim();
      const others = parts.filter(s => !s.includes('DRIVE:'));
      if (others.length >= 3) {
         insightCards = [
           { title: "SUCCESS", text: others[0] },
           { title: "GAP", text: others[1] },
           { title: "MOVE", text: others[2] }
         ];
      }
    }
  }

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
      {/* Header */}
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

      {/* Date Filters */}
      <div className="bg-white rounded-[32px] p-3 border border-slate-100 shadow-sm flex flex-col md:flex-row items-center gap-4 no-export">
         <div className="flex gap-2">
            {(['all', '7d', '30d', 'custom'] as TimeRange[]).map((r) => (
              <button key={r} onClick={() => setTimeRange(r)} className={`px-5 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all ${timeRange === r ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-50 text-slate-400'}`}>
                {r === 'all' ? 'Full History' : r === '7d' ? '7 Days' : r === '30d' ? '30 Days' : 'Custom'}
              </button>
            ))}
         </div>
         
         {/* Custom Range Inputs */}
         {timeRange === 'custom' && (
           <div className="flex items-center gap-2 animate-in slide-in-from-left-4 fade-in duration-300">
              <div className="flex items-center gap-2 bg-slate-50 px-4 py-2 rounded-xl border border-slate-100">
                <Calendar className="w-4 h-4 text-slate-400" />
                <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="bg-transparent text-xs font-bold text-slate-700 outline-none" />
              </div>
              <span className="text-slate-300 font-bold">-</span>
              <div className="flex items-center gap-2 bg-slate-50 px-4 py-2 rounded-xl border border-slate-100">
                <Calendar className="w-4 h-4 text-slate-400" />
                <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="bg-transparent text-xs font-bold text-slate-700 outline-none" />
              </div>
           </div>
         )}
      </div>

      {/* KPI Row */}
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
          <div className="mt-6 space-y-3 overflow-y-auto max-h-[220px] pr-2 custom-scrollbar">
             {stats.sortedProducts.length > 0 ? (
               stats.sortedProducts.map((p, i) => (
                 <div key={i} className="flex justify-between text-[10px] font-bold border-b border-slate-50 pb-2 last:border-0 last:pb-0">
                   <span className="text-slate-500 truncate max-w-[180px]" title={p.name}>{p.name}</span>
                   <span className="text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">x{p.count}</span>
                 </div>
               ))
             ) : (
               <p className="text-xs text-slate-300 font-medium text-center py-10">No items found in range.</p>
             )}
          </div>
        </KPIContainer>
        
        <KPIContainer label="Top Seller" value={stats.topProduct ? stats.topProduct.name : 'None'} subtitle={`${stats.topProduct ? stats.topProduct.count : 0} units sold`}>
           <div className="mt-8 p-5 bg-indigo-50 rounded-3xl">
              <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Performance</p>
              <p className="text-xs font-bold text-indigo-900 italic">
                {stats.topProduct ? `Generating ${(stats.topProduct.revenue / stats.totalRevenue * 100).toFixed(1)}% of revenue.` : "No data yet."}
              </p>
           </div>
        </KPIContainer>
      </div>

      {/* AI Insights */}
      <div className="bg-slate-900 rounded-[40px] p-8 md:p-10 text-white shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <BrainCircuit className="w-6 h-6 text-indigo-400" />
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400">Gemini Strategy</span>
        </div>
        <h2 className="text-3xl font-black mb-10 leading-tight">
           {isAiLoading ? "Processing data..." : driveText}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
           {insightCards.map((card, i) => (
             <div key={i} className="bg-white/5 border border-white/5 p-6 rounded-3xl">
               <p className="text-[9px] font-black tracking-widest uppercase text-slate-500 mb-2">{card.title}</p>
               <p className="text-sm text-slate-300 leading-relaxed">{card.text}</p>
             </div>
           ))}
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-[40px] shadow-xl">
           <h3 className="text-xl font-black mb-8 flex items-center gap-3"><TrendingUp className="w-5 h-5 text-orange-500" /> Revenue</h3>
           <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueTrend}>
                  <XAxis dataKey="date" tick={{fontSize: 9}} tickFormatter={(val) => val.slice(5)} />
                  <Tooltip content={<CustomRevenueTooltip />} cursor={{ stroke: '#f97316', strokeWidth: 2, strokeDasharray: '5 5' }} />
                  <Area type="monotone" dataKey="revenue" stroke="#f97316" fill="#f97316" fillOpacity={0.1} />
                </AreaChart>
              </ResponsiveContainer>
           </div>
        </div>
        <div className="bg-white p-8 rounded-[40px] shadow-xl">
           <h3 className="text-xl font-black mb-8 flex items-center gap-3"><CalendarDays className="w-5 h-5 text-emerald-500" /> Best Days of the Week</h3>
           <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={busiestDays}>
                  <XAxis dataKey="name" tick={{fontSize: 9}} />
                  <Tooltip content={<CustomDayTooltip />} cursor={{fill: '#f1f5f9'}} />
                  <Bar dataKey="quantity" fill="#059669" radius={[10, 10, 0, 0]} />
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
