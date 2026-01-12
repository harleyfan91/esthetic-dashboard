import React, { useState, useRef } from 'react';
import { 
  Upload, CheckCircle2, Loader2, AlertCircle, Eye, ExternalLink, X
} from 'lucide-react';
import { MasterRecord, SaleRecord } from '../types';
import { GoogleDriveService } from '../lib/googleDrive';
import { GoogleGenAI, Type } from "@google/genai";
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
      if (!mapping) {
        setProcessingStep('AI is mapping your columns...');
        try {
          const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
          if (!apiKey || apiKey.trim() === '') {
             if (window.aistudio?.openSelectKey) await window.aistudio.openSelectKey();
          }

          const ai = new GoogleGenAI({ apiKey: apiKey! });
          const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Identify column headers for: date, product, amount, category, quantity. Columns available: ${Object.keys(json[0]).join(', ')}`,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  date: { type: Type.STRING },
                  product: { type: Type.STRING },
                  amount: { type: Type.STRING },
                  category: { type: Type.STRING },
                  quantity: { type: Type.STRING },
                },
                required: ["date", "product", "amount"]
              }
            }
          });
          const text = response.text;
          if (text) mapping = JSON.parse(text);
        } catch (apiErr: any) {
          console.error("Gemini AI Error:", apiErr);
        }
      }

      if (!mapping || !mapping.date || !mapping.product) {
        setPendingData({ json, fileName });
        setManualMapping({ date: '', product: '', amount: '', category: '', quantity: '' });
        setIsProcessing(false);
        return;
      }

      finalizeProcess(json, mapping, fileName);
    } catch (err: any) {
      setError(err.message || "Mapping failed.");
      setIsProcessing(false);
    }
  };

  const finalizeProcess = (json: any[], mapping: any, fileName: string) => {
    try {
      setProcessingStep('Building master records...');
      
      // ✅ REFINED DATE PARSER FOR INCOMPLETE DATES
      const parseDate = (val: any) => {
        if (!val) return new Date().toLocaleDateString("en-CA");

        let dateObj: Date | null = null;

        // 1. Excel Serial Date
        if (typeof val === 'number') {
           if (val > 25569) dateObj = new Date(Math.round((val - 25569) * 86400 * 1000));
        }
        // 2. Strings
        else {
           let dateStr = String(val).trim();
           // Regex: Check if there is a 4 digit year (e.g. 2026 or 1999)
           // \b matches word boundaries
           const hasYear = /\b(19|20)\d{2}\b/.test(dateStr);
           
           if (!hasYear) {
               // If user provides "Jan 02" or "01/05", append current year
               const currentYear = new Date().getFullYear();
               dateStr = `${dateStr} ${currentYear}`;
           }
           
           dateObj = new Date(dateStr);
        }

        if (dateObj && !isNaN(dateObj.getTime())) {
          // Format strictly YYYY-MM-DD using local time parts to avoid UTC shift
          const year = dateObj.getFullYear();
          const month = String(dateObj.getMonth() + 1).padStart(2, '0');
          const day = String(dateObj.getDate()).padStart(2, '0');
          
          // Legacy Fix: If year somehow still ended up as 19xx (e.g. Excel parsed 1900), bump it
          if (year < 2000) {
              return `${year + 100}-${month}-${day}`;
          }
          return `${year}-${month}-${day}`;
        }
        
        return new Date().toLocaleDateString("en-CA");
      };

      const newSales: SaleRecord[] = json
        .map((item, idx) => {
          const rawAmount = item[mapping.amount];
          const cleanAmount = typeof rawAmount === 'string' 
            ? parseFloat(rawAmount.replace(/[^0-9.-]+/g, "")) 
            : parseFloat(rawAmount || 0);

          return {
            id: `${fileName}-${idx}-${Date.now()}`,
            date: parseDate(item[mapping.date]),
            product: String(item[mapping.product] || 'Unknown'),
            category: String(item[mapping.category] || 'General'),
            amount: isNaN(cleanAmount) ? 0 : cleanAmount,
            quantity: parseInt(item[mapping.quantity]) || 1,
          };
        })
        .filter(s => s.amount > 0 || (s.product !== 'Unknown' && s.product !== ''));

      if (newSales.length === 0) throw new Error("No data found.");

      const addedCount = onSync(newSales, mapping, fileName);
      setSyncStatus({ success: true, count: addedCount || newSales.length });
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
      {/* --- PREVIEW MODAL --- */}
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

      {/* --- MAPPING MODAL --- */}
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
                   <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{field} *</label>
                   <select 
                    value={manualMapping[field]} 
                    onChange={(e) => setManualMapping({...manualMapping, [field]: e.target.value})}
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-xl px-4 py-3 font-bold"
                   >
                     <option value="">-- Choose Column --</option>
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

      {/* --- HEADER --- */}
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

      {/* --- MAIN UPLOAD AREA --- */}
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
