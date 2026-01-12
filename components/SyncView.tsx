console.log("Check Keys:", { 
  google: !!import.meta.env.VITE_GOOGLE_API_KEY, 
  gemini: !!import.meta.env.VITE_GEMINI_API_KEY 
});

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Layout } from './components/Layout';
import { SetupWizard } from './components/SetupWizard';
import { SyncView } from './components/SyncView';
import { DashboardView } from './components/DashboardView';
import { MasterRecord, ViewState, SaleRecord } from './types';
import { GoogleDriveService } from './lib/googleDrive';

const FALLBACK_CLIENT_ID = '298405130840-2m8lsjjfdab0ha2g3dmanqd9abu62ph5.apps.googleusercontent.com';
const GOOGLE_CLIENT_ID = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || FALLBACK_CLIENT_ID;
const MASTER_FILE_NAME = 'Esthetic_Master_Record.json';

const App: React.FC = () => {
  const [view, setView] = useState<ViewState>('setup');
  const [master, setMaster] = useState<MasterRecord | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [googleUser, setGoogleUser] = useState<any>(null);
  const [cloudSyncing, setCloudSyncing] = useState(false);

  const googleService = useMemo(() => {
    const geminiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
    const googleKey = import.meta.env.VITE_GOOGLE_API_KEY || '';
    (window as any).process = { env: { API_KEY: geminiKey } };
    return new GoogleDriveService(GOOGLE_CLIENT_ID, googleKey);
  }, []);

  useEffect(() => {
    const savedMaster = localStorage.getItem('maker_master_record');
    if (savedMaster) {
      try {
        setMaster(JSON.parse(savedMaster));
        setView('sync');
      } catch (e) {
        console.error("Failed to parse local record", e);
      }
    }
    setIsLoaded(true);
    googleService.initGis().catch(err => console.warn("Background cloud init pending:", err));
  }, [googleService]);

  useEffect(() => {
    if (master && googleUser && googleService.getStoredToken()) {
      const syncToCloud = async () => {
        setCloudSyncing(true);
        try {
          const fileMeta = await googleService.saveJsonToCloud(MASTER_FILE_NAME, master);
          if (fileMeta?.webViewLink && master.googleFileUrl !== fileMeta.webViewLink) {
             const updated = { ...master, googleFileUrl: fileMeta.webViewLink };
             setMaster(updated);
             localStorage.setItem('maker_master_record', JSON.stringify(updated));
          }
        } catch (e) {
          console.error("Cloud Sync Failed", e);
        } finally {
          setCloudSyncing(false);
        }
      };
      
      const debounce = setTimeout(syncToCloud, 3000);
      return () => clearTimeout(debounce);
    }
  }, [master, googleUser, googleService]);

  const handleSetupComplete = (data: string | MasterRecord) => {
    if (typeof data === 'string') {
      const newMaster: MasterRecord = {
        id: Math.random().toString(36).substr(2, 9),
        name: data,
        lastUpdated: new Date().toISOString(),
        totalSales: 0,
        totalRevenue: 0,
        data: [],
        syncedFiles: []
      };
      setMaster(newMaster);
      localStorage.setItem('maker_master_record', JSON.stringify(newMaster));
    } else {
      setMaster(data);
      localStorage.setItem('maker_master_record', JSON.stringify(data));
    }
    setView('sync');
  };

  const updateMaster = useCallback((newSales: SaleRecord[], schema?: any, fileName?: string) => {
    if (!master) return 0;
    const updatedData = [...master.data, ...newSales];
    const updatedSyncedFiles = [...(master.syncedFiles || [])];
    if (fileName && !updatedSyncedFiles.includes(fileName)) updatedSyncedFiles.push(fileName);
    
    const updatedMaster: MasterRecord = {
      ...master,
      data: updatedData,
      lastUpdated: new Date().toISOString(),
      totalSales: updatedData.length,
      totalRevenue: updatedData.reduce((acc, s) => acc + s.amount, 0),
      mappingSchema: schema || master.mappingSchema,
      syncedFiles: updatedSyncedFiles
    };
    setMaster(updatedMaster);
    localStorage.setItem('maker_master_record', JSON.stringify(updatedMaster));
    return newSales.length;
  }, [master]);

  const saveAnalysis = useCallback((insight: string) => {
    if (!master) return;
    const updatedMaster = { ...master, lastStrategicInsight: insight, analysisTimestamp: new Date().toISOString() };
    setMaster(updatedMaster);
    localStorage.setItem('maker_master_record', JSON.stringify(updatedMaster));
  }, [master]);

  const handleSwitchFile = () => {
    localStorage.removeItem('maker_master_record');
    setMaster(null);
    setView('setup');
  };

  const handleSignOut = () => {
    localStorage.removeItem('maker_master_record');
    window.location.reload();
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="font-black text-slate-400 uppercase tracking-[0.3em] text-[10px]">Initializing...</p>
      </div>
    );
  }

  return (
    <Layout 
      currentView={view} 
      setView={setView} 
      masterName={master?.name} 
      googleUser={googleUser} 
      onSignOut={handleSignOut}
      onSwitchFile={handleSwitchFile} 
      cloudSyncing={cloudSyncing}
    >
      {view === 'setup' && (
        <SetupWizard 
          onComplete={handleSetupComplete} 
          googleService={googleService} 
          onAuthenticated={setGoogleUser} 
        />
      )}
      {view === 'sync' && master && (
        <SyncView 
          master={master} 
          onSync={updateMaster} 
          googleService={googleService} 
        />
      )}
      {view === 'analyze' && master && (
        <DashboardView 
          master={master} 
          onSaveAnalysis={saveAnalysis} 
        />
      )}
    </Layout>
  );
};

export default App;
