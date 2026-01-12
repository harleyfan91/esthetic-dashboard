import React, { useState, useRef } from 'react';
import { 
  Upload, CheckCircle2, Loader2, AlertCircle, Eye, ExternalLink, X, Sparkles 
} from 'lucide-react';
import { MasterRecord, SaleRecord } from '../types';
import { GoogleDriveService } from '../lib/googleDrive';
import * as XLSX from 'xlsx';

interface SyncViewProps {
  master: MasterRecord;
  onSync: (sales: SaleRecord[], schema?: any, fileName?: string) => number | undefined;
  googleService: GoogleDriveService | null;
}

export const SyncView: React.FC<SyncViewProps> = ({ master, onSync, googleService }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState<string>('');
  const [syncStatus, setSyncStatus] = useState<{ success: boolean; count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingData, setPendingData] = useState<{ json: any[], fileName: string } | null>(null);
  const [manualMapping, setManualMapping] = useState<any>(null);
  const [showPreview, setShowPreview] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper for Direct API Calls (Bypassing Library)
  const callGeminiDirect = async (prompt: string): Promise<string> => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) throw new Error("API Key missing");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });

    if (!response.ok) throw new Error(`Gemini API Error: ${response.statusText}`);
    
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  };

  const processData = async (data: any, fileName: string) => {
    setIsProcessing(true);
    setError(null);
    setProcessingStep('Reading report content...');
    
    try {
      if (master.syncedFiles && master.syncedFiles.includes(fileName)) {
        throw new Error(`File "${fileName}" has already been synced.`);
      }

      const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
      const sheetName = workbook.SheetNames[0];
      const json = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" }) as any[];

      if (json.length === 0) throw new Error("The selected file appears to be empty.");

      let mapping = master.mappingSchema;
      
      // 1. Initial Auto-Mapping
      if (!mapping) {
        setProcessingStep('AI is mapping your columns...');
        try {
          const prompt = `
            Identify column headers for: date, product, amount, category, quantity. 
            Columns available: ${Object.keys(json[0]).join(', ')}
            Return JSON only.
          `;
          
          const jsonText = await callGeminiDirect(prompt);
          const cleanJson = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
          mapping = JSON.parse(cleanJson);
        } catch (apiErr: any) {
          console.error("Gemini AI Error:", apiErr);
        }
      }

      // 2. Fallback to Manual Mapping
      if (!mapping || !mapping.date || !mapping.product) {
        setPendingData({ json, fileName });
        setManualMapping({ date: '', product: '', amount: '', category: '', quantity: '' });
        setIsProcessing(false);
        return;
      }

      await finalizeProcess(json, mapping, fileName);
    } catch (err: any) {
      setError(err.message || "Mapping failed.");
      setIsProcessing(false);
    }
  };

  const finalizeProcess = async (json: any[], mapping: any, fileName: string) => {
    try {
      setProcessingStep('Building master records...');
      
      const parseDate = (val: any) => {
        if (!val) return new Date().toLocaleDateString("en-CA");
        if (typeof val === 'number') {
           if (val > 25569) {
             const dateObj = new Date(Math.round((val - 25569) * 86400 * 1000));
             const y = dateObj.getUTCFullYear();
             const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
             const d = String(dateObj.getUTCDate()).padStart(2, '0');
             return `${y}-${m}-${d}`;
           }
        }
        const str = String(val).trim();
        const currentYear = new Date().getFullYear();
        const monthDayRegex = /^([A-Za-z]{3})[\s-./]+(\d{1,2})$/i;
        const match = str.match(monthDayRegex);

        if (match) {
          const months: {[key: string]: number} = {
            jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11
          };
          const mStr = match[1].toLowerCase();
          const dNum = parseInt(match[2]);
          if (months[mStr] !== undefined) {
             const d = new Date(currentYear, months[mStr], dNum, 12, 0, 0);
             return d.toISOString().split('T')[0];
          }
        }
        
        let dateToParse = str;
        if (!/\d{4}/.test(str)) dateToParse = `${str} ${currentYear}`;
        const d = new Date(dateToParse);
        if (!isNaN(d.getTime())) {
          if (d.getFullYear() < 2010) d.setFullYear(currentYear);
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${y}-${m}-${day}`;
        }
        return new Date().toISOString().split('T')[0];
      };

      // 1. Initial Parse
      let parsedSales: SaleRecord[] = json
        .map((item, idx) => {
          const rawAmount = item[mapping.amount];
          const cleanAmount = typeof rawAmount === 'string' 
            ? parseFloat(rawAmount.replace(/[^0-9.-]+/g, "")) 
            : parseFloat(rawAmount || 0);
          
          const rawProduct = String(item[mapping.product] || 'Unknown');
          const rawCategory = mapping.category ? String(item[mapping.category] || 'General') : 'General';

          return {
            id: `${fileName}-${idx}-${Date.now()}`,
            date: parseDate(item[mapping.date]),
            product: rawProduct,
            category: rawCategory,
            amount: isNaN(cleanAmount) ? 0 : cleanAmount,
            quantity: parseInt(item[mapping.quantity]) || 1,
          };
        })
        .filter(s => s.amount > 0 || (s.product !== 'Unknown' && s.product !== ''));

      // 2. AI ENRICHMENT (Categorization) - Using Direct Fetch
      const needsEnrichment = !mapping.category || parsedSales.some(s => s.category === 'General');
      
      if (needsEnrichment) {
        setProcessingStep('AI is categorizing your jewelry...');
        
        const uniqueProducts = [...new Set(parsedSales.map(s => s.product))];
        const batchSize = 50; 
        const batches = [];
        for (let i = 0; i < uniqueProducts.length; i += batchSize) {
           batches.push(uniqueProducts.slice(i, i + batchSize));
        }

        const enrichmentMap: Record<string, { category: string, cleanName: string }> = {};

        for (const batch of batches) {
          try {
             const prompt = `
               You are a jewelry inventory assistant. 
               Task: Map each input to a category and a clean name.
               
               Allowed Categories: [Rings, Bracelets, Necklaces, Pendants, Earrings, Anklets, Charms, Sets, Other]
               
               Rules:
               1. Clean Name must remove sizes (e.g., "Size 7") or metal types (e.g., "14k") if it makes the name cleaner.
               2. If an item doesn't fit, use "Other".
               
               Input List: ${JSON.stringify(batch)}
               
               Return ONLY a JSON object where keys are the exact input strings.
               Example: { "Gold Ring Sz 6": { "category": "Rings", "cleanName": "Gold Ring" } }
             `;

             const jsonText = await callGeminiDirect(prompt);
             const cleanJson = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
             const batchResult = JSON.parse(cleanJson);
             Object.assign(enrichmentMap, batchResult);
          } catch (e) {
             console.error("Batch enrichment failed", e);
          }
        }

        parsedSales = parsedSales.map(sale => {
           const enriched = enrichmentMap[sale.product];
           if (enriched) {
             return { 
               ...sale, 
               category: enriched.category || sale.category,
             };
           }
           return sale;
        });
      }

      if (parsedSales.length === 0) throw new Error("No data found.");

      const addedCount = onSync(parsedSales, mapping, fileName);
      setSyncStatus({ success: true, count: addedCount || parsedSales.length });
      setPendingData(null);
    } catch (err: any) {
      setError(err.message || "Sync failed.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDrivePick = async () => {
    if (!googleService) return;
    setError(null);
    try {
      let token = googleService.getStoredToken();
      if (!token) {
        setIsProcessing(true);
        token = await googleService.authenticate();
        setIsProcessing(false);
      }
      googleService.openPicker(token, async (file) => {
        setIsProcessing(true);
        setProcessingStep(`Importing ${file.name}...`);
        try {
          const blob = await googleService.downloadFile(file.id, file.mimeType);
          const reader = new FileReader();
          reader.onload = (e) => processData(e.target?.result, file.name);
          reader.readAsBinaryString(blob);
        } catch (err: any) {
          setError(`Import failed: ${err.message}`);
          setIsProcessing(false);
        }
      });
    } catch (err: any) {
      setError(err.message || "Drive error.");
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-8 pb-20 relative">
      {showPreview && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[250] flex items-center justify-center p-4">
           <div className="bg-white rounded-[32px] w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                 <div>
                    <h3 className="text-xl font-black text-slate-900">Database Preview</h3>
                    <p className="text-sm text-slate-500 font-medium">Viewing {master.data.length} records</p>
                 </div>
                 <button onClick={() => setShowPreview(false)} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-200 transition-colors">
                    <X className="w-5 h-5 text-slate-500" />
                 </button>
              </div>
              <div className="overflow-auto flex-1 p-0">
                 <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-400 font-black uppercase text-[10px] tracking-wider sticky top-0 z-10">
                       <tr>
                          <th className="px-6 py-4">Date</th>
                          <th className="px-6 py-4">Product</th>
                          <th className="px-6 py-4">Category</th>
                          <th className="px-6 py-4">Qty</th>
                          <th className="px-6 py-4 text-right">Amount</th>
                       </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                       {master.data.slice().reverse().slice(0, 50).map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50/50">
                             <td className="px-6 py-3 font-bold text-slate-600 whitespace-nowrap">{row.date}</td>
                             <td className="px-6 py-3 font-medium text-slate-900">{row.product}</td>
                             <td className="px-6 py-3 text-slate-500">{row.category}</td>
                             <td className="px-6 py-3 text-slate-500">{row.quantity}</td>
                             <td className="px-6 py-3 font-bold text-slate-900 text-right">${row.amount.toFixed(2)}</td>
                          </tr>
                       ))}
                       {master.data.length === 0 && (
                          <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-400 font-medium">No records found.</td></tr>
                       )}
                    </tbody>
                 </table>
              </div>
              <div className="p-6 border-t border-slate-100 flex justify-between items-center bg-slate-50">
                 <p className="text-xs font-bold text-slate-400">* Showing last 50 entries</p>
                 {master.googleFileUrl && (
                    <a href={master.googleFileUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-indigo-600 font-black text-sm hover:underline">
                       Open in Google Drive <ExternalLink className="w-4 h-4" />
                    </a>
                 )}
              </div>
           </div>
        </div>
      )}

      {pendingData && manualMapping && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[250] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-xl shadow-2xl overflow-hidden">
            <div className="p-8 border-b border-slate-100 bg-indigo-50/20">
              <h3 className="text-2xl font-black text-slate-900">Confirm Columns</h3>
              <p className="text-slate-500 text-sm font-medium">Please match headers for <b>{pendingData.fileName}</b></p>
            </div>
            <div className="p-8 space-y-4 max-h-[50vh] overflow-y-auto">
               {['date', 'product', 'amount', 'category', 'quantity'].map((field) => (
                 <div key={field} className="space-y-1">
                   <div className="flex justify-between">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{field} {field !== 'category' && '*'}</label>
                      {field === 'category' && <span className="text-[10px] font-bold text-indigo-500 flex items-center gap-1"><Sparkles className="w-3 h-3" /> Auto-Fill</span>}
                   </div>
                   <select 
                    value={manualMapping[field]} 
                    onChange={(e) => setManualMapping({...manualMapping, [field]: e.target.value})}
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-xl px-4 py-3 font-bold"
                   >
                     <option value="">{field === 'category' ? '-- Auto-Detect with AI --' : '-- Choose Column --'}</option>
                     {Object.keys(pendingData.json[0]).map(col => <option key={col} value={col}>{col}</option>)}
                   </select>
                 </div>
               ))}
            </div>
            <div className="p-8 bg-slate-50 flex gap-4">
              <button onClick={() => setPendingData(null)} className="flex-1 font-bold text-slate-400">Cancel</button>
              <button onClick={() => finalizeProcess(pendingData.json, manualMapping, pendingData.fileName)} className="flex-[2] py-4 bg-indigo-600 text-white font-black rounded-2xl">Sync Now</button>
            </div>
          </div>
        </div>
      )}

      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
           <h1 className="text-4xl font-black text-slate-900 tracking-tight">Sync Sales</h1>
           <p className="text-slate-500 font-medium">Update your business history with Gemini Flash.</p>
        </div>
        <button 
           onClick={() => setShowPreview(true)}
           className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 shadow-sm rounded-xl font-bold text-slate-600 text-sm hover:border-indigo-300 hover:text-indigo-600 transition-all"
        >
           <Eye className="w-4 h-4" /> Preview Database
        </button>
      </header>

      <div className={`relative min-h-[480px] rounded-[48px] border-4 border-dashed transition-all duration-500 flex flex-col items-center justify-center p-12 bg-white ${isProcessing ? 'border-indigo-100' : 'border-slate-200 hover:border-indigo-300'}`}>
        {isProcessing ? (
          <div className="text-center">
            <Loader2 className="w-20 h-20 text-indigo-600 animate-spin mx-auto mb-8" />
            <h3 className="text-2xl font-black text-slate-900 mb-2">Processing</h3>
            <p className="text-indigo-500 font-bold text-sm animate-pulse tracking-wide">{processingStep}</p>
          </div>
        ) : syncStatus ? (
          <div className="text-center animate-in zoom-in">
            <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-6" />
            <h3 className="text-3xl font-black text-slate-900">Success</h3>
            <p className="text-slate-500 font-medium">{syncStatus.count} records added.</p>
            <button onClick={() => setSyncStatus(null)} className="mt-8 px-12 py-4 bg-slate-900 text-white font-bold rounded-2xl">Done</button>
          </div>
        ) : error ? (
          <div className="text-center max-w-md">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-2xl font-black text-slate-900">Error</h3>
            <p className="text-red-500 font-medium mt-2">{error}</p>
            <button onClick={() => setError(null)} className="w-full mt-8 py-4 bg-slate-900 text-white font-black rounded-2xl">Retry</button>
          </div>
        ) : (
          <>
            <Upload className="w-12 h-12 text-indigo-600 mb-8" />
            <h3 className="text-3xl font-black text-slate-900 mb-2">Import File</h3>
            <p className="text-slate-500 text-center max-w-sm font-medium mb-12">Choose a spreadsheet from your computer or Google Drive.</p>
            <div className="flex flex-col gap-4 w-full max-w-xs">
              <button onClick={handleDrivePick} className="w-full bg-indigo-600 text-white font-black py-5 rounded-2xl shadow-lg hover:bg-indigo-700">Open Drive</button>
              <button onClick={() => fileInputRef.current?.click()} className="w-full bg-white border-2 border-slate-200 text-slate-400 font-bold py-4 rounded-2xl text-sm">Upload CSV/Excel</button>
            </div>
            <input type="file" ref={fileInputRef} className="hidden" accept=".csv,.xlsx,.xls" onChange={(e) => {
              const f = e.target.files?.[0];
              if(f) {
                const reader = new FileReader();
                reader.onload = (ev) => processData(ev.target?.result, f.name);
                reader.readAsBinaryString(f);
              }
            }} />
          </>
        )}
      </div>
    </div>
  );
};
