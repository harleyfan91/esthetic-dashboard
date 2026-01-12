import React, { useState, useRef } from 'react';
import { Database, ArrowRight, Loader2, Cloud, Sparkles, History, Upload } from 'lucide-react';
import { GoogleDriveService } from '../lib/googleDrive';
import { MasterRecord } from '../types';

interface SetupWizardProps {
  onComplete: (data: string | MasterRecord) => void;
  googleService: GoogleDriveService;
  onAuthenticated: (user: any) => void;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({ onComplete, googleService, onAuthenticated }) => {
  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState('Business Sales History');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [foundCloudRecord, setFoundCloudRecord] = useState<MasterRecord | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MASTER_FILE_NAME = 'Esthetic_Master_Record.json';

  const handleConnect = async () => {
    setIsAuthenticating(true);
    setError(null);
    try {
      const token = await googleService.authenticate();
      
      const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { 
        headers: { Authorization: `Bearer ${token}` } 
      });
      
      if (!response.ok) throw new Error("Could not retrieve user profile.");
      
      const userData = await response.json();
      onAuthenticated({ name: userData.name, email: userData.email, picture: userData.picture });
      
      setIsSearching(true);
      const existingFile = await googleService.findFileByName(MASTER_FILE_NAME);
      if (existingFile) {
        const cloudData = await googleService.downloadFile(existingFile.id);
        if (cloudData && cloudData.id) {
          setFoundCloudRecord(cloudData);
        }
      }
      setIsSearching(false);
      setStep(2);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Connection failed. Please check your credentials.");
    } finally { 
      setIsAuthenticating(false); 
      setIsSearching(false);
    }
  };

  const handleLocalUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (json.id && json.data) {
          onComplete(json);
        } else {
          setError("Invalid Master Record file.");
        }
      } catch (err) {
        setError("Could not parse file.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="max-w-xl mx-auto mt-20 text-center px-4 pb-20">
      {step === 1 && (
        <div className="bg-white p-12 rounded-[56px] shadow-2xl border border-slate-100 animate-in fade-in slide-in-from-bottom-6 duration-700">
          <div className="w-20 h-20 bg-indigo-600 rounded-[32px] flex items-center justify-center mx-auto mb-8 shadow-xl shadow-indigo-100">
            <Cloud className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-4xl font-black text-slate-900 mb-4 tracking-tighter">Esthetic Dashboard</h2>
          <p className="text-slate-500 mb-10 font-medium text-lg leading-relaxed">
            Link your Google account to store your master records privately on your own Drive.
          </p>

          <div className="space-y-4 mb-10">
            <button 
              onClick={handleConnect} 
              disabled={isAuthenticating} 
              className="w-full bg-indigo-600 text-white font-black py-6 rounded-[32px] transition-all shadow-xl shadow-indigo-100 flex items-center justify-center gap-3 group text-xl hover:bg-indigo-700 active:scale-95 disabled:opacity-50"
            >
              {isAuthenticating ? <Loader2 className="w-6 h-6 animate-spin" /> : "Sign in with Google"}
              {!isAuthenticating && <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />}
            </button>

            {/* Added: Option to upload local backup */}
            <div className="relative py-4">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-slate-100"></span></div>
              <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-slate-400 font-bold tracking-widest">Or</span></div>
            </div>

            <button 
              onClick={() => fileInputRef.current?.click()}
              className="w-full bg-white border-2 border-slate-100 text-slate-400 font-bold py-4 rounded-[32px] hover:border-indigo-100 hover:text-indigo-500 transition-all flex items-center justify-center gap-2"
            >
              <Upload className="w-4 h-4" /> Upload Local Master File
            </button>
            <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleLocalUpload} />

            {error && (
              <div className="p-4 bg-red-50 rounded-2xl border border-red-100 mt-4">
                <p className="text-red-500 font-bold text-xs">{error}</p>
              </div>
            )}
          </div>
          <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Secure Private Connection</p>
        </div>
      )}

      {step === 2 && (
        <div className="bg-white p-12 rounded-[56px] shadow-2xl border border-slate-100 animate-in fade-in zoom-in duration-500">
          {isSearching ? (
             <div className="py-20 flex flex-col items-center">
               <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
               <p className="font-black text-slate-400 uppercase tracking-widest text-[10px]">Searching for existing records...</p>
             </div>
          ) : foundCloudRecord ? (
            <>
              <div className="w-20 h-20 bg-amber-50 rounded-[32px] flex items-center justify-center mx-auto mb-8">
                <Sparkles className="w-10 h-10 text-amber-500" />
              </div>
              <h2 className="text-3xl font-black text-slate-900 mb-2 tracking-tighter">Welcome Back</h2>
              <p className="text-slate-500 mb-10 font-medium">Found your existing Master Record: <b>{foundCloudRecord.name}</b></p>
              
              <div className="bg-slate-50 p-6 rounded-[32px] mb-8 text-left space-y-3">
                 <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Revenue</span>
                    <span className="text-sm font-black text-slate-900">${foundCloudRecord.totalRevenue.toLocaleString()}</span>
                 </div>
                 <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Sales</span>
                    <span className="text-sm font-black text-slate-900">{foundCloudRecord.totalSales} records</span>
                 </div>
              </div>

              <div className="space-y-4">
                <button 
                  onClick={() => onComplete(foundCloudRecord)} 
                  className="w-full bg-indigo-600 text-white font-black py-6 rounded-[32px] shadow-xl text-xl hover:bg-indigo-700 active:scale-95 transition-all flex items-center justify-center gap-3"
                >
                  <History className="w-5 h-5" /> Resume Business
                </button>
                <button 
                  onClick={() => setFoundCloudRecord(null)} 
                  className="text-[10px] font-black text-slate-300 uppercase tracking-widest hover:text-red-500 transition-colors"
                >
                  or start a new master file
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="w-20 h-20 bg-emerald-50 rounded-[32px] flex items-center justify-center mx-auto mb-8">
                <Database className="w-10 h-10 text-emerald-600" />
              </div>
              <h2 className="text-3xl font-black text-slate-900 mb-2 tracking-tighter">Name Your Record</h2>
              <p className="text-slate-500 mb-10 font-medium">This is the title of your permanent history file.</p>
              
              <input 
                type="text" 
                value={fileName} 
                onChange={(e) => setFileName(e.target.value)} 
                className="w-full px-8 py-6 rounded-[32px] border-4 border-slate-50 focus:border-indigo-500 text-center text-2xl font-black outline-none mb-8 bg-slate-50/50 transition-all"
                placeholder="e.g. My Shop History" 
              />
              
              <button 
                onClick={() => onComplete(fileName)} 
                className="w-full bg-slate-900 text-white font-black py-6 rounded-[32px] shadow-xl text-xl hover:bg-black active:scale-95 transition-all"
              >
                Start Dashboard
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
